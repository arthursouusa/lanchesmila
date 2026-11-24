/* =====================================================================
   APP.JS — o "motor" do site (só funcionamento)
   =====================================================================

   O QUE ESTE ARQUIVO FAZ
   Sacola, cupons, cashback, horário de funcionamento, navegação entre
   telas e envio do pedido pelo WhatsApp.

   O QUE ELE NÃO TEM
   Textos, preços, produtos, horários, cupons e endereço. Tudo isso fica
   no index.html. Você edita lá e o JS LÊ de lá na hora de calcular.

   O QUE O JS PROCURA NO HTML (se mudar estes nomes, o site não acha):
     #loja-nome  #loja-taxa  #loja-minimo  #loja-endereco  #loja-whatsapp
     .horarios li[data-dia]        -> horários (lê os dois "HH:MM" do texto)
     #cashback-percentual          -> % do cashback (se não existir = sem cashback)
     .produto[data-id][data-grupos] -> produtos (nome, descrição, preço, foto)
     #grupos .grupo[data-grupo]    -> grupos de opções (data-min / data-max)
     .cupom[data-codigo ...]       -> cupons (data-tipo, data-valor, data-minimo)
     <html data-tema="claro">      -> tema padrão ("claro" ou "escuro")

   PREÇOS: o JS lê o número do texto. "R$ 16,00", "16,00" ou "16" funcionam.
   "Grátis", "Incluso" ou texto sem número valem zero.
   ===================================================================== */


/* =====================================================================
   1. AJUSTES (as únicas coisas "de configuração" que ficam no JS)
   ===================================================================== */
const CONFIG = {
  // Nome interno usado para guardar a sacola no aparelho do cliente.
  // Troque se você tiver mais de um site no mesmo endereço.
  chaveSalva: "pedidos-minha-lanchonete",

  // true = aceita pedido mesmo com a loja fechada.
  permitirPedidoFechada: false,

  // PARA TESTAR: "aberta" ou "fechada" ignoram o horário. Deixe "" no dia a dia.
  forcarStatus: "",
};


/* =====================================================================
   2. ATALHOS E UTILITÁRIOS
   ===================================================================== */
const $  = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

const arredondar = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const dinheiro   = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const normalizar = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Texto de um elemento (ou "" se ele não existir)
const textoDe = (seletor, raiz = document) => { const el = $(seletor, raiz); return el ? el.textContent.trim() : ""; };
// Troca o texto de um elemento (se ele existir)
const escrever = (seletor, valor) => { const el = $(seletor); if (el) el.textContent = valor; };

// "R$ 1.234,50" -> 1234.5   |   "Grátis" -> 0
function lerPreco(texto) {
  const m = String(texto).match(/\d[\d.]*(?:,\d+)?/);
  if (!m) return 0;
  let n = m[0];
  if (n.includes(","))                 n = n.replace(/\./g, "").replace(",", ".");
  else if (!/\.\d{1,2}$/.test(n))      n = n.replace(/\./g, "");   // "1.234" = mil; "12.5" = 12,5
  return parseFloat(n) || 0;
}

// Copia um <template> do HTML
const clonar = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);

const decodificar = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

// ----- Fotos: quadro sem <img> mostra o ícone vazio -----
function ajustarFotos(raiz = document) {
  $$(".foto", raiz).forEach((q) => q.classList.toggle("foto--vazia", !$("img", q)));
}
function colocarFoto(quadro, src, alt) {
  quadro.replaceChildren();
  if (src) { const img = new Image(); img.alt = alt || ""; img.src = src; quadro.append(img); }
  quadro.classList.toggle("foto--vazia", !src);
}
// Se um arquivo de imagem não abrir, volta para o ícone vazio
document.addEventListener("error", (e) => {
  const q = e.target.tagName === "IMG" && e.target.closest(".foto");
  if (q) { e.target.remove(); q.classList.add("foto--vazia"); }
}, true);

// Aviso que some sozinho
let temporizadorAviso;
function aviso(mensagem) {
  const el = $("#aviso");
  el.textContent = mensagem;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, 2400);
}

// Compartilhar o link atual (ou copiar, se o aparelho não compartilha)
async function compartilhar(titulo) {
  const dados = { title: titulo || loja.nome(), url: location.href };
  try {
    if (navigator.share) await navigator.share(dados);
    else { await navigator.clipboard.writeText(dados.url); aviso("Link copiado!"); }
  } catch (e) { /* o cliente cancelou */ }
}

// Máscara de telefone: (11) 91234-5678
function mascaraTelefone(valor) {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2)  return `(${d}`;
  if (d.length <= 6)  return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}


/* =====================================================================
   3. DADOS QUE VÊM DO HTML
   ===================================================================== */

// ----- Dados da loja -----
const loja = {
  nome:     () => textoDe("#loja-nome"),
  taxa:     () => lerPreco(textoDe("#loja-taxa")),      // "Grátis" = 0
  minimo:   () => lerPreco(textoDe("#loja-minimo")),
  endereco: () => textoDe("#loja-endereco"),
  whatsapp: () => (($("#loja-whatsapp") || {}).href || "").replace(/\D/g, ""),   // só os dígitos do link
  cashback: () => lerPreco(textoDe("#cashback-percentual")),                    // 0 = sem cashback
};

// ----- Produtos (ficam dentro das telas de categoria) -----
const SELETOR_PRODUTO = '[data-tela="categoria"] .produto';

function lerProduto(li) {
  const img = $(".foto img", li);
  return {
    li,
    id: li.dataset.id,
    nome: textoDe(".linha-produto__nome", li),
    descricao: textoDe(".linha-produto__descricao", li),
    preco: lerPreco(textoDe(".linha-produto__preco", li)),
    foto: img ? img.getAttribute("src") : "",
    grupos: (li.dataset.grupos || "").split(/\s+/).filter(Boolean),
    esgotado: !!$(".tag--esgotado", li),                  // tem a tag "Esgotado" = esgotado
    categoria: li.closest("[data-tela]").dataset.id,
  };
}
function produtoPorId(id) {
  const li = $$(SELETOR_PRODUTO).find((x) => x.dataset.id === id);
  return li ? lerProduto(li) : null;
}

// ----- Grupos de opções (adicionais, bebida...) -----
function lerGrupo(gid) {
  const el = $$("#grupos .grupo").find((g) => g.dataset.grupo === gid);
  if (!el) return null;
  return {
    id: gid,
    el,
    min: Number(el.dataset.min) || 0,
    max: Number(el.dataset.max) || 1,
    itens: $$(".opcao", el).map((li) => ({
      id: li.dataset.id,
      nome: textoDe(".opcao__nome", li),
      preco: lerPreco(textoDe(".opcao__preco", li)),
      esgotado: !!$(".tag--esgotado", li),
    })),
  };
}
function buscarOpcao(gid, oid) {
  const g = lerGrupo(gid);
  return g ? g.itens.find((i) => i.id === oid) || null : null;
}

// ----- Cupons (ficam na tela Promoções) -----
function lerCupom(codigo) {
  const cod = String(codigo).trim().toUpperCase();
  const li = $$(".cupom").find((c) => c.dataset.codigo === cod);
  if (!li) return null;
  return {
    codigo: cod,
    titulo: textoDe(".cupom__titulo strong", li),
    tipo: li.dataset.tipo,                       // "valor", "percentual" ou "frete"
    valor: Number(li.dataset.valor) || 0,
    minimo: Number(li.dataset.minimo) || 0,
    primeiroPedido: li.hasAttribute("data-primeiro-pedido"),
  };
}


/* =====================================================================
   4. ESTADO SALVO NO NAVEGADOR (sacola, dados do cliente, pedidos)
   ===================================================================== */
const TEMA_PADRAO = document.documentElement.dataset.tema || "claro";

const estadoInicial = () => ({
  tema: null,                 // "claro" | "escuro" | null (usa o padrão do HTML)
  carrinho: [],               // itens: { chave, produtoId, qtd, opcoes: [{grupo,id,qtd}], obs }
  tipo: "entrega",            // "entrega" | "retirada"
  cupom: "",
  usarCashback: false,
  saldo: 0,
  cliente: { nome: "", whats: "" },
  endereco: { rua: "", numero: "", bairro: "", complemento: "", referencia: "" },
  pagamento: "",              // nome da forma de pagamento escolhida
  pedidos: [],
  proximo: 1,
});

function carregar() {
  const base = estadoInicial();
  try {
    const salvo = JSON.parse(localStorage.getItem(CONFIG.chaveSalva)) || {};
    return Object.assign(base, salvo, {
      cliente:  Object.assign(base.cliente,  salvo.cliente),
      endereco: Object.assign(base.endereco, salvo.endereco),
    });
  } catch (e) {
    return base;
  }
}
let estado = carregar();

function salvar() {
  try { localStorage.setItem(CONFIG.chaveSalva, JSON.stringify(estado)); } catch (e) { /* sem armazenamento */ }
  atualizarMarcadores();
}

function aplicarTema() { document.documentElement.dataset.tema = estado.tema || TEMA_PADRAO; }
function alternarTema() {
  estado.tema = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
  salvar();
  aplicarTema();
}

const clienteOk = () =>
  estado.cliente.nome.trim().length >= 2 && estado.cliente.whats.replace(/\D/g, "").length >= 10;


/* =====================================================================
   5. HORÁRIO E STATUS DA LOJA
   ===================================================================== */
const NOMES_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const paraMinutos = (hora) => { const [h, m] = hora.split(":").map(Number); return h * 60 + m; };

// Lê do HTML o horário de um dia (0 = domingo). Devolve { abre, fecha } ou null (fechado).
function horarioDoDia(dia) {
  const li = $$(".horarios li").find((l) => Number(l.dataset.dia) === dia);
  const horas = li ? textoDe("strong", li).match(/\d{1,2}:\d{2}/g) : null;
  return horas && horas.length >= 2 ? { abre: horas[0], fecha: horas[1] } : null;
}

// Devolve { aberta: true/false, texto: "..." }
function statusLoja() {
  if (CONFIG.forcarStatus === "aberta")  return { aberta: true,  texto: "Aberta agora" };
  if (CONFIG.forcarStatus === "fechada") return { aberta: false, texto: "Loja fechada" };

  const agora = new Date();
  const dia = agora.getDay();
  const min = agora.getHours() * 60 + agora.getMinutes();

  // 1) Está dentro do horário de hoje?
  const hoje = horarioDoDia(dia);
  if (hoje) {
    const abre = paraMinutos(hoje.abre), fecha = paraMinutos(hoje.fecha);
    const dentro = fecha > abre ? (min >= abre && min < fecha) : (min >= abre);   // fecha <= abre: passa da meia-noite
    if (dentro) return { aberta: true, texto: `Aberta até ${hoje.fecha}` };
  }

  // 2) Ainda está no horário de ontem que passou da meia-noite?
  const ontem = horarioDoDia((dia + 6) % 7);
  if (ontem) {
    const abre = paraMinutos(ontem.abre), fecha = paraMinutos(ontem.fecha);
    if (fecha <= abre && min < fecha) return { aberta: true, texto: `Aberta até ${ontem.fecha}` };
  }

  // 3) Fechada: descobre a próxima abertura
  for (let i = 0; i <= 7; i++) {
    const d = (dia + i) % 7;
    const h = horarioDoDia(d);
    if (!h) continue;
    if (i === 0 && paraMinutos(h.abre) <= min) continue;
    const quando = i === 0 ? "hoje" : i === 1 ? "amanhã" : NOMES_DIAS[d].toLowerCase();
    return { aberta: false, texto: `Loja fechada, abre ${quando} às ${h.abre}` };
  }
  return { aberta: false, texto: "Loja fechada" };
}

const lojaPodePedir = () => statusLoja().aberta || CONFIG.permitirPedidoFechada;

// Atualiza todos os "Aberta agora / Loja fechada" do site
function atualizarStatus() {
  const st = statusLoja();
  $$(".status").forEach((el) => {
    el.dataset.estado = st.aberta ? "aberta" : "fechada";
    const span = $("span", el);
    if (span) span.textContent = st.texto;
  });
}


/* =====================================================================
   6. SACOLA, CUPONS E CÁLCULOS
   ===================================================================== */
const qtdCarrinho = () => estado.carrinho.reduce((s, i) => s + i.qtd, 0);

// Preço de UMA unidade do item = preço do produto + opções (sempre lido do HTML atual)
function precoUnit(item) {
  const p = produtoPorId(item.produtoId);
  if (!p) return 0;
  const extras = item.opcoes.reduce((s, o) => {
    const op = buscarOpcao(o.grupo, o.id);
    return s + (op ? op.preco * o.qtd : 0);
  }, 0);
  return arredondar(p.preco + extras);
}
const subtotalCarrinho = () => arredondar(estado.carrinho.reduce((s, i) => s + precoUnit(i) * i.qtd, 0));

// Tira da sacola produtos que não existem mais no HTML (ex.: você apagou do cardápio)
function limparCarrinho() {
  estado.carrinho = estado.carrinho.filter((i) => produtoPorId(i.produtoId));
}

// Põe um item na sacola (junta com um item idêntico, se já houver)
function adicionarAoCarrinho({ produtoId, qtd, opcoes, obs }) {
  const chave = JSON.stringify([produtoId, opcoes.map((o) => [o.grupo, o.id, o.qtd]), obs]);
  const igual = estado.carrinho.find((i) => i.chave === chave);
  if (igual) igual.qtd += qtd;
  else estado.carrinho.push({ chave, produtoId, qtd, opcoes, obs });
  salvar();
}

// Confere se um cupom pode ser usado agora. Devolve { ok, cupom, motivo }
function validarCupom(codigo, subtotal) {
  const c = lerCupom(codigo);
  if (!c) return { ok: false, motivo: "Cupom não encontrado." };
  if (c.primeiroPedido && estado.pedidos.length > 0)
    return { ok: false, cupom: c, motivo: "Esse cupom vale só no primeiro pedido." };
  if (c.tipo === "frete" && estado.tipo !== "entrega")
    return { ok: false, cupom: c, motivo: "Esse cupom vale só para entrega." };
  if (c.minimo && subtotal < c.minimo)
    return { ok: false, cupom: c, motivo: `Esse cupom vale para pedidos a partir de ${dinheiro(c.minimo)}.` };
  return { ok: true, cupom: c };
}

// Calcula todos os valores do pedido
function totais() {
  const subtotal = subtotalCarrinho();
  const taxa = estado.tipo === "entrega" ? loja.taxa() : 0;
  let desconto = 0, descFrete = 0, cashbackUsado = 0, cupom = null, motivoCupom = "";

  if (estado.cupom) {
    const v = validarCupom(estado.cupom, subtotal);
    if (v.ok) {
      cupom = v.cupom;
      if (cupom.tipo === "valor")      desconto  = Math.min(cupom.valor, subtotal);
      if (cupom.tipo === "percentual") desconto  = arredondar(subtotal * cupom.valor / 100);
      if (cupom.tipo === "frete")      descFrete = Math.min(cupom.valor, taxa);
    } else {
      motivoCupom = v.motivo;
    }
  } else if (estado.usarCashback && loja.cashback() > 0) {
    cashbackUsado = Math.min(estado.saldo, subtotal + taxa);   // cashback e cupom não se juntam
  }

  const total = Math.max(0, arredondar(subtotal - desconto + taxa - descFrete - cashbackUsado));
  return { subtotal, taxa, desconto, descFrete, cashbackUsado, total, cupom, motivoCupom };
}

// Preenche os blocos "Subtotal / Desconto / Entrega / Total" (sacola e finalizar)
function preencherResumo(t) {
  const descontoTotal = t.desconto + t.descFrete;
  $$(".resumo").forEach((dl) => {
    const linha = (nome) => $(`[data-linha="${nome}"]`, dl);
    $("dd", linha("subtotal")).textContent = dinheiro(t.subtotal);
    $("dd", linha("desconto")).textContent = "- " + dinheiro(descontoTotal);
    $("dd", linha("entrega")).textContent  = t.taxa > 0 ? dinheiro(t.taxa) : "Grátis";
    $("dd", linha("cashback")).textContent = "- " + dinheiro(t.cashbackUsado);
    $("dd", linha("total")).textContent    = dinheiro(t.total);
    linha("desconto").hidden = descontoTotal <= 0;
    linha("entrega").hidden  = estado.tipo !== "entrega";
    linha("cashback").hidden = t.cashbackUsado <= 0;
  });
}


/* =====================================================================
   7. NAVEGAÇÃO ENTRE TELAS
   O endereço depois do # decide a tela:  #/produto/x-burguer
   Cada tela do HTML é uma <section class="tela" data-tela="nome">.
   ===================================================================== */
const topo = { titulo: "", pai: "/", compartilhar: "" };   // o que o topo mostra na tela atual
let rotaAtual = "inicio";
let navegou = false;        // já passou por mais de uma tela? (para o botão voltar)
let veioDeTroca = false;

// Vai para outra tela sem criar uma entrada nova no histórico (usado em redirecionamentos)
function trocar(hash) { veioDeTroca = true; location.replace(hash); }

function voltar() {
  if (navegou) history.back();
  else location.hash = "#" + topo.pai;
}

// Qual item do menu de baixo fica destacado em cada tela
const MENU_DA_ROTA = {
  inicio: "inicio", categoria: "inicio", busca: "inicio", produto: "inicio", loja: "inicio",
  promos: "promos",
  sacola: "sacola", identificar: "sacola", finalizar: "sacola",
  pedidos: "pedidos", sucesso: "pedidos",
};
const ROTAS_SEM_BARRA_SACOLA = ["sacola", "identificar", "finalizar", "sucesso", "produto"];

// Leva o cliente até as categorias, mesmo quando ele está em outra tela.
function irAoCardapio() {
  const rolar = () => $("#cardapio")?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (rotaAtual === "inicio") {
    rolar();
    return;
  }
  window.addEventListener("hashchange", rolar, { once: true });
  location.hash = "#/";
}

// Atualiza contadores e alterna o botão flutuante entre cardápio e sacola.
function atualizarMarcadores() {
  const qtd = qtdCarrinho();
  const badgeSacola = $("#badge-sacola");
  badgeSacola.textContent = qtd;
  badgeSacola.hidden = qtd === 0;

  const cupons = $$(".cupom").length;
  const badgePromos = $("#badge-promos");
  badgePromos.textContent = cupons;
  badgePromos.hidden = cupons === 0;

  const barra = $("#barra-sacola");
  const mostrarBarra = !ROTAS_SEM_BARRA_SACOLA.includes(rotaAtual);
  barra.hidden = !mostrarBarra;
  $("#barra-sacola-texto").textContent = qtd > 0 ? "Ver sacola" : "Faça seu pedido";
  $("#barra-sacola-resumo").hidden = qtd === 0;
  $("#barra-sacola-qtd").textContent = qtd;
  $("#barra-sacola-total").textContent = dinheiro(subtotalCarrinho());
  barra.setAttribute("aria-label", qtd > 0 ? `Ver sacola, ${qtd} ${qtd === 1 ? "item" : "itens"}, total ${dinheiro(subtotalCarrinho())}` : "Faça seu pedido: ir ao cardápio");
  document.body.classList.toggle("cta-flutuante-ativo", mostrarBarra);
}

function mostrarTela(manterRolagem = false) {
  const [nomeBruto, param = ""] = location.hash.replace(/^#\/?/, "").split("/").map(decodificar);
  const nome = nomeBruto || "inicio";
  const tela = $$(".tela").find((t) => t.dataset.tela === nome && (nome !== "categoria" || t.dataset.id === param));
  if (!tela) { trocar("#/"); return; }

  const rolagem = window.scrollY;
  rotaAtual = nome;
  $$(".tela").forEach((t) => { t.hidden = t !== tela; });

  // Topo: título e "voltar" vêm do data-titulo / data-pai da tela (algumas telas ajustam abaixo)
  topo.titulo = tela.dataset.titulo || "";
  topo.pai = tela.dataset.pai || "/";
  topo.compartilhar = "";

  const preparar = PREPARAR[nome];
  if (preparar && preparar(tela, param) === false) return;   // false = a tela redirecionou

  $("#topo").hidden = !topo.titulo;
  $("#topo-titulo").textContent = topo.titulo;
  $("#topo-compartilhar").hidden = !topo.compartilhar;

  $$(".menu__item").forEach((el) => el.classList.toggle("is-ativo", el.dataset.rota === MENU_DA_ROTA[nome]));
  atualizarStatus();
  atualizarMarcadores();
  window.scrollTo(0, manterRolagem ? rolagem : 0);
}
const atualizarTela = () => mostrarTela(true);


/* =====================================================================
   8. TELAS
   Cada função "preparar..." roda quando a tela é aberta e preenche só o
   que muda (ex.: a lista de itens da sacola). O texto fixo fica no HTML.
   ===================================================================== */

/* ---------- INÍCIO ---------- */

// Cards do carrossel "Os mais pedidos": os ids vêm do data-produtos no HTML
function montarDestaques() {
  const caixa = $("#destaques");
  if (!caixa) return;
  (caixa.dataset.produtos || "").split(/\s+/).map(produtoPorId).filter(Boolean).forEach((p) => {
    const no = clonar("tpl-destaque");
    $(".card-destaque__nome", no).textContent = p.nome;
    $(".card-destaque__preco", no).textContent = dinheiro(p.preco);
    colocarFoto($(".foto", no), p.foto, p.nome);
    $(".card-destaque__link", no).href = "#/produto/" + p.id;
    const mais = $(".card-destaque__mais", no);
    if (p.esgotado) mais.hidden = true;
    else mais.onclick = () => adicionarRapido(p);
    caixa.append(no);
  });
  if (!caixa.children.length) caixa.closest("section").hidden = true;   // sem destaques: esconde a seção
}

// Botão "+" dos destaques: adiciona direto, ou abre o produto se houver escolha obrigatória
function adicionarRapido(p) {
  if (!lojaPodePedir()) { aviso(statusLoja().texto); return; }
  const precisaEscolher = p.grupos.some((g) => { const gr = lerGrupo(g); return gr && gr.min > 0; });
  if (precisaEscolher) { location.hash = "#/produto/" + p.id; return; }
  adicionarAoCarrinho({ produtoId: p.id, qtd: 1, opcoes: [], obs: "" });
  aviso(`${p.nome} adicionado à sacola`);
}

function aplicarCupomEIr(codigo) {
  estado.cupom = codigo;
  estado.usarCashback = false;
  salvar();
  aviso(`Cupom ${codigo} aplicado`);
  location.hash = "#/sacola";
}

/* ---------- CATEGORIA E BUSCA ---------- */
function prepararCategoria(tela, id) {
  // O título é o nome do quadro da tela inicial que leva a esta categoria
  const quadro = $$("a.quadro").find((a) => a.getAttribute("href") === "#/categoria/" + id);
  topo.titulo = quadro ? textoDe(".quadro__nome", quadro) : "Cardápio";
}

function prepararBusca(tela, termo) {
  const t = normalizar(termo);
  const lista = $("#busca-resultados");
  lista.replaceChildren();
  $$(SELETOR_PRODUTO)
    .filter((li) => normalizar(textoDe(".linha-produto__nome", li) + " " + textoDe(".linha-produto__descricao", li)).includes(t))
    .forEach((li) => lista.append(li.cloneNode(true)));
  $("#busca-vazio").hidden = lista.children.length > 0;
  topo.titulo = "Busca: " + termo;
}

/* ---------- PRODUTO ---------- */
function prepararProduto(tela, id) {
  const p = produtoPorId(id);
  if (!p) { trocar("#/"); return false; }

  topo.pai = "/categoria/" + p.categoria;
  topo.compartilhar = p.nome;

  escrever("#p-nome", p.nome);
  escrever("#p-preco", dinheiro(p.preco));
  escrever("#p-descricao", p.descricao);
  colocarFoto($("#p-foto"), p.foto, p.nome);
  $("#p-obs").value = "";

  // ----- grupos de opções: selecoes[grupoId] = { itemId: quantidade } -----
  const selecoes = {}, grupos = {};
  const caixa = $("#p-grupos");
  caixa.replaceChildren();
  p.grupos.forEach((gid) => {
    const g = lerGrupo(gid);
    if (!g) return;
    grupos[gid] = g;
    selecoes[gid] = {};
    g.no = montarGrupo(g, selecoes[gid], recalcular);
    caixa.append(g.no);
  });

  // ----- barra de baixo: aberta, fechada ou esgotado -----
  const bloqueio = p.esgotado ? "Produto esgotado" : (!lojaPodePedir() ? statusLoja().texto : "");
  $("#p-barra-aberta").hidden = !!bloqueio;
  $("#p-barra-fechada").hidden = !bloqueio;
  escrever("#p-motivo", bloqueio);

  // ----- quantidade e total -----
  let qtd = 1;
  $("#p-menos").onclick = () => { if (qtd > 1)  { qtd--; recalcular(); } };
  $("#p-mais").onclick  = () => { if (qtd < 50) { qtd++; recalcular(); } };

  function opcoesEscolhidas() {
    const lista = [];
    Object.keys(selecoes).forEach((gid) => {
      grupos[gid].itens.forEach((it) => {
        const q = selecoes[gid][it.id] || 0;
        if (q > 0) lista.push({ grupo: gid, id: it.id, qtd: q, preco: it.preco });
      });
    });
    return lista;
  }
  function recalcular() {
    const extras = opcoesEscolhidas().reduce((s, o) => s + o.preco * o.qtd, 0);
    escrever("#p-total", dinheiro((p.preco + extras) * qtd));
    escrever("#p-qtd", qtd);
    $("#p-menos").disabled = qtd <= 1;
  }

  $("#p-adicionar").onclick = () => {
    if (!lojaPodePedir()) { aviso(statusLoja().texto); return; }
    for (const gid of Object.keys(selecoes)) {       // confere escolhas obrigatórias
      const total = Object.values(selecoes[gid]).reduce((s, q) => s + q, 0);
      if (total < grupos[gid].min) {
        aviso(`Escolha: ${textoDe(".bloco__titulo", grupos[gid].no)}`);
        grupos[gid].no.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    adicionarAoCarrinho({
      produtoId: p.id,
      qtd,
      opcoes: opcoesEscolhidas().map(({ grupo, id, qtd }) => ({ grupo, id, qtd })),
      obs: $("#p-obs").value.trim(),
    });
    aviso(`${p.nome} adicionado à sacola`);
    voltar();
  };

  recalcular();
}

// Copia o grupo do HTML e liga os botões de cada opção. "selecao" é alterada diretamente.
function montarGrupo(g, selecao, aoMudar) {
  const no = g.el.cloneNode(true);
  const unico = g.max === 1;                 // escolha única (bolinha) ou várias (contador)
  const total = () => Object.values(selecao).reduce((s, q) => s + q, 0);
  const redesenhar = [];

  $$(".opcao", no).forEach((li, i) => {
    const item = g.itens[i];
    const controle = $(".opcao__controle", li);

    if (item.esgotado) {
      li.classList.add("opcao--esgotada");

    } else if (unico) {
      const bolinha = document.createElement("span");
      bolinha.className = "radio";
      controle.append(bolinha);
      li.classList.add("opcao--clicavel");
      li.tabIndex = 0;                       // dá para escolher pelo teclado também
      li.setAttribute("role", "radio");
      li.onclick = () => {
        const jaEstava = selecao[item.id] > 0;
        Object.keys(selecao).forEach((k) => delete selecao[k]);
        if (!(jaEstava && g.min === 0)) selecao[item.id] = 1;
        redesenhar.forEach((f) => f());
        aoMudar();
      };
      li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); li.click(); } };
      redesenhar.push(() => {
        const ligado = selecao[item.id] > 0;
        bolinha.setAttribute("aria-checked", String(ligado));
        li.setAttribute("aria-checked", String(ligado));
        li.classList.toggle("opcao--selecionada", ligado);
      });

    } else {
      const contador = clonar("tpl-contador");
      controle.append(contador);
      const menos = $('[data-acao="menos"]', contador);
      const mais  = $('[data-acao="mais"]', contador);
      menos.onclick = () => {
        if (selecao[item.id] > 0) selecao[item.id]--;
        if (!selecao[item.id]) delete selecao[item.id];
        redesenhar.forEach((f) => f());
        aoMudar();
      };
      mais.onclick = () => {
        if (total() < g.max) selecao[item.id] = (selecao[item.id] || 0) + 1;
        redesenhar.forEach((f) => f());
        aoMudar();
      };
      redesenhar.push(() => {
        const q = selecao[item.id] || 0;
        $(".contador__qtd", contador).textContent = q;
        menos.disabled = q === 0;
        mais.disabled = total() >= g.max;
        li.classList.toggle("opcao--selecionada", q > 0);
      });
    }
  });

  redesenhar.forEach((f) => f());
  return no;
}

/* ---------- SACOLA ---------- */
let mensagemCupomTemporaria = "";   // erro ao digitar um cupom inválido

function prepararSacola() {
  limparCarrinho();
  const vazia = estado.carrinho.length === 0;
  $("#sacola-vazia").hidden = !vazia;
  $("#sacola-cheia").hidden = vazia;
  if (vazia) return;

  const t = totais();

  // ----- itens -----
  const lista = $("#sacola-itens");
  lista.replaceChildren();
  estado.carrinho.forEach((item) => {
    const p = produtoPorId(item.produtoId);
    const li = clonar("tpl-sacola-item");
    const nomesOpcoes = item.opcoes.map((o) => {
      const op = buscarOpcao(o.grupo, o.id);
      return op ? (o.qtd > 1 ? `${o.qtd}x ` : "") + op.nome : "";
    }).filter(Boolean);
    $(".sacola-item__nome", li).textContent = p.nome;
    $(".sacola-item__opcoes", li).textContent = nomesOpcoes.join(", ");
    $(".sacola-item__obs", li).textContent = item.obs ? `Obs.: ${item.obs}` : "";
    $(".sacola-item__preco", li).textContent = dinheiro(precoUnit(item) * item.qtd);
    colocarFoto($(".foto", li), p.foto, p.nome);

    const contador = clonar("tpl-contador");
    $(".sacola-item__contador", li).append(contador);
    $(".contador__qtd", contador).textContent = item.qtd;
    const menos = $('[data-acao="menos"]', contador);
    menos.disabled = item.qtd <= 1;
    menos.onclick = () => { item.qtd--; salvar(); atualizarTela(); };
    $('[data-acao="mais"]', contador).onclick = () => { item.qtd++; salvar(); atualizarTela(); };
    $('[data-acao="remover"]', li).onclick = () => {
      estado.carrinho = estado.carrinho.filter((i) => i !== item);
      salvar();
      atualizarTela();
    };
    lista.append(li);
  });

  // ----- entrega ou retirada -----
  $$(".segmentado__btn").forEach((b) => b.classList.toggle("is-ativo", b.dataset.tipo === estado.tipo));

  // ----- mensagem do cupom -----
  const msg = $("#cupom-msg");
  msg.hidden = true;
  if (mensagemCupomTemporaria) {
    msg.textContent = mensagemCupomTemporaria;
    msg.classList.add("msg--erro"); msg.hidden = false;
    mensagemCupomTemporaria = "";
  } else if (estado.cupom && t.cupom) {
    msg.textContent = `Cupom ${t.cupom.codigo} aplicado: ${t.cupom.titulo}`;
    msg.classList.remove("msg--erro"); msg.hidden = false;
  } else if (estado.cupom) {
    msg.textContent = `Cupom ${estado.cupom}: ${t.motivoCupom}`;
    msg.classList.add("msg--erro"); msg.hidden = false;
  }
  $("#cupom-remover").hidden = !estado.cupom;
  $("#cupom-campo").value = "";

  // ----- cashback -----
  const temCashback = loja.cashback() > 0 && estado.saldo > 0;
  $("#cashback-bloco").hidden = !temCashback;
  escrever("#cashback-saldo-sacola", `(${dinheiro(estado.saldo)})`);
  $("#cashback-usar").checked = estado.usarCashback && !estado.cupom;

  // ----- resumo e botão continuar -----
  preencherResumo(t);

  let problema = "";
  const sub = subtotalCarrinho();
  const esgotado = estado.carrinho.map((i) => produtoPorId(i.produtoId)).find((p) => p.esgotado);
  if (sub < loja.minimo())
    problema = `Pedido mínimo de ${dinheiro(loja.minimo())} em itens. Faltam ${dinheiro(loja.minimo() - sub)}.`;
  else if (!lojaPodePedir())
    problema = statusLoja().texto;
  else if (esgotado)
    problema = `${esgotado.nome} está esgotado. Remova da sacola para continuar.`;
  escrever("#sacola-aviso", problema);
  $("#sacola-aviso").hidden = !problema;
  $("#sacola-continuar").disabled = !!problema;
}

/* ---------- IDENTIFICAÇÃO (nome e WhatsApp) ---------- */
function prepararIdentificar() {
  $("#id-whats").value = estado.cliente.whats;
  $("#id-nome").value = estado.cliente.nome;
  conferirIdentificacao();
}
function conferirIdentificacao() {
  const ok = $("#id-whats").value.replace(/\D/g, "").length >= 10 && $("#id-nome").value.trim().length >= 2;
  $("#id-avancar").disabled = !ok;
}

/* ---------- FINALIZAR PEDIDO ---------- */
const nomeDaForma = (radio) => textoDe("strong", radio.closest(".escolha"));

function prepararFinalizar() {
  if (estado.carrinho.length === 0) { trocar("#/sacola"); return false; }
  if (!clienteOk()) { trocar("#/identificar"); return false; }

  const entrega = estado.tipo === "entrega";
  escrever("#fin-nome", estado.cliente.nome);
  escrever("#fin-whats", estado.cliente.whats);
  escrever("#fin-endereco-loja", loja.endereco());
  $("#fin-endereco").hidden = !entrega;
  $("#fin-retirada").hidden = entrega;

  Object.keys(estado.endereco).forEach((k) => { $(`#fin-${k}`).value = estado.endereco[k] || ""; });
  $$('input[name="pagamento"]').forEach((r) => { r.checked = nomeDaForma(r) === estado.pagamento; });
  atualizarTroco();
  $("#fin-erro").hidden = true;

  const t = totais();
  preencherResumo(t);
  escrever("#fin-total", dinheiro(t.total));
}

function atualizarTroco() {
  const marcado = $$('input[name="pagamento"]').find((r) => r.checked);
  $("#fin-troco-bloco").hidden = !(marcado && marcado.hasAttribute("data-troco"));
}

function enviarFormulario(e) {
  e.preventDefault();
  const erro = $("#fin-erro");
  const mostrarErro = (m) => { erro.textContent = m; erro.hidden = false; erro.scrollIntoView({ behavior: "smooth", block: "center" }); };
  erro.hidden = true;

  const t = totais();
  const entrega = estado.tipo === "entrega";
  const esgotado = estado.carrinho.map((i) => produtoPorId(i.produtoId)).find((p) => p && p.esgotado);

  if (!lojaPodePedir()) return mostrarErro(statusLoja().texto);
  if (subtotalCarrinho() < loja.minimo()) return mostrarErro(`Pedido mínimo de ${dinheiro(loja.minimo())} em itens.`);
  if (esgotado) return mostrarErro(`${esgotado.nome} está esgotado. Remova da sacola.`);
  if (estado.cupom && !t.cupom) return mostrarErro(`Revise o cupom na sacola: ${t.motivoCupom}`);
  if (entrega) {
    const { rua, numero, bairro } = estado.endereco;
    if (!rua.trim() || !numero.trim() || !bairro.trim()) return mostrarErro("Preencha rua, número e bairro para a entrega.");
  }
  const radio = $$('input[name="pagamento"]').find((r) => r.checked);
  if (!radio) return mostrarErro("Escolha a forma de pagamento.");

  let troco = "";
  if (radio.hasAttribute("data-troco")) {
    const bruto = $("#fin-troco").value.trim();
    if (bruto) {
      const valor = lerPreco(bruto);
      if (!(valor > t.total)) return mostrarErro(`O troco precisa ser para um valor maior que ${dinheiro(t.total)}.`);
      troco = dinheiro(valor);
    }
  }
  enviarPedido(t, nomeDaForma(radio), radio.hasAttribute("data-troco"), troco, $("#fin-recado").value.trim());
}

/* ---------- PEDIDO ENVIADO / MEUS PEDIDOS ---------- */
function prepararSucesso(tela, numero) {
  const pedido = estado.pedidos.find((p) => p.numero === numero);
  if (!pedido) { trocar("#/"); return false; }
  escrever("#suc-numero", "#" + pedido.numero);
  $("#suc-whatsapp").href = pedido.link;
  escrever("#suc-cashback", `Você ganhou ${dinheiro(pedido.ganho)} de cashback para o próximo pedido`);
  $("#suc-cashback").hidden = !(pedido.ganho > 0);
}

function prepararPedidos() {
  $("#pedidos-vazio").hidden = estado.pedidos.length > 0;
  const lista = $("#pedidos-lista");
  lista.replaceChildren();
  estado.pedidos.forEach((p) => {
    const li = clonar("tpl-pedido");
    $(".pedido__numero", li).textContent = "Pedido #" + p.numero;
    $(".pedido__data", li).textContent = new Date(p.data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    $(".pedido__tipo", li).textContent = p.tipo;
    $(".pedido__total", li).textContent = dinheiro(p.total);
    $(".pedido__detalhe", li).textContent = p.mensagem;
    $(".pedido__reenviar", li).href = p.link;
    lista.append(li);
  });
}

/* ---------- PROMOÇÕES ---------- */
function trocarAba(nome) {
  $$("[data-aba]").forEach((b) => b.classList.toggle("is-ativo", b.dataset.aba === nome));
  $$("[data-painel]").forEach((p) => { p.hidden = p.dataset.painel !== nome; });
}
function prepararPromos(tela, aba) {
  const temCashback = loja.cashback() > 0;
  $('[data-aba="cashback"]').hidden = !temCashback;
  escrever("#cashback-saldo", dinheiro(estado.saldo));
  trocarAba(aba === "cashback" && temCashback ? "cashback" : "cupons");
}

/* ---------- INFORMAÇÕES DA LOJA ---------- */
function prepararLoja() {
  const hoje = new Date().getDay();
  $$(".horarios li").forEach((li) => li.classList.toggle("is-hoje", Number(li.dataset.dia) === hoje));
  $("#loja-mapa").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(loja.endereco());
}

// Qual função prepara cada tela (nome da tela -> função)
const PREPARAR = {
  categoria: prepararCategoria,
  busca: prepararBusca,
  produto: prepararProduto,
  sacola: prepararSacola,
  identificar: prepararIdentificar,
  finalizar: prepararFinalizar,
  sucesso: prepararSucesso,
  pedidos: prepararPedidos,
  promos: prepararPromos,
  loja: prepararLoja,
};


/* =====================================================================
   9. ENVIO DO PEDIDO (monta a mensagem e abre o WhatsApp)
   ===================================================================== */
function enviarPedido(t, formaNome, pedeTroco, troco, recado) {
  const numero = String(estado.proximo).padStart(4, "0");
  const entrega = estado.tipo === "entrega";
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  // ----- texto da mensagem -----
  const L = [];
  L.push(`*Novo pedido #${numero}* - ${loja.nome()} (${agora})`);
  L.push(`Cliente: ${estado.cliente.nome}`);
  L.push(`WhatsApp: ${estado.cliente.whats}`);
  L.push(`Tipo: ${entrega ? "Entrega" : "Retirada na loja"}`);
  if (entrega) {
    const e = estado.endereco;
    L.push(`Endereço: ${e.rua}, ${e.numero} - ${e.bairro}` +
      (e.complemento ? ` (${e.complemento})` : "") +
      (e.referencia ? ` | Ref.: ${e.referencia}` : ""));
  }
  L.push("", "*Itens*");
  estado.carrinho.forEach((item) => {
    const p = produtoPorId(item.produtoId);
    L.push(`${item.qtd}x ${p.nome} - ${dinheiro(precoUnit(item) * item.qtd)}`);
    item.opcoes.forEach((o) => {
      const op = buscarOpcao(o.grupo, o.id);
      if (op) L.push(`   + ${o.qtd > 1 ? o.qtd + "x " : ""}${op.nome}`);
    });
    if (item.obs) L.push(`   Obs.: ${item.obs}`);
  });
  L.push("");
  L.push(`Subtotal: ${dinheiro(t.subtotal)}`);
  if (t.desconto + t.descFrete > 0) L.push(`Desconto (${t.cupom.codigo}): - ${dinheiro(t.desconto + t.descFrete)}`);
  if (entrega) L.push(`Entrega: ${t.taxa > 0 ? dinheiro(t.taxa) : "Grátis"}`);
  if (t.cashbackUsado > 0) L.push(`Cashback usado: - ${dinheiro(t.cashbackUsado)}`);
  L.push(`*Total: ${dinheiro(t.total)}*`);
  L.push(`Pagamento: ${formaNome}` + (pedeTroco ? (troco ? ` (troco para ${troco})` : " (sem troco)") : ""));
  if (recado) L.push(`Recado: ${recado}`);
  const mensagem = L.join("\n");

  const link = `https://wa.me/${loja.whatsapp()}?text=${encodeURIComponent(mensagem)}`;

  // ----- cashback ganho (sobre o que foi pago em itens) -----
  const base = Math.max(0, t.subtotal - t.desconto - t.cashbackUsado);
  const ganho = arredondar(base * loja.cashback() / 100);

  // ----- guarda o pedido e limpa a sacola -----
  estado.saldo = arredondar(estado.saldo - t.cashbackUsado + ganho);
  estado.pedidos.unshift({
    numero, data: new Date().toISOString(),
    tipo: entrega ? "Entrega" : "Retirada",
    total: t.total, ganho, mensagem, link,
  });
  estado.proximo += 1;
  estado.carrinho = [];
  estado.cupom = "";
  estado.usarCashback = false;
  salvar();

  window.open(link, "_blank", "noopener");   // se o navegador bloquear, a próxima tela tem o botão
  location.hash = "#/sucesso/" + numero;
}


/* =====================================================================
   10. LIGANDO OS BOTÕES (roda uma vez, quando a página abre)
   ===================================================================== */
function ligarEventos() {
  // botão flutuante: com itens abre a sacola; sem itens leva às categorias
  $("#barra-sacola").onclick = () => {
    if (qtdCarrinho() > 0) location.hash = "#/sacola";
    else irAoCardapio();
  };

  // topo e tela inicial
  $("#topo-voltar").onclick = voltar;
  $("#topo-compartilhar").onclick = () => compartilhar(topo.compartilhar);
  $("#btn-tema").onclick = alternarTema;
  $("#btn-compartilhar").onclick = () => compartilhar();
  $("#form-busca").onsubmit = (e) => {
    e.preventDefault();
    const termo = $("#busca-campo").value.trim();
    if (termo) location.hash = "#/busca/" + encodeURIComponent(termo);
  };

  // qualquer botão com data-cupom: "Usar cupom" do banner e "Aplicar na sacola" da tela Promoções
  document.addEventListener("click", (e) => {
    const botao = e.target.closest("[data-cupom]");
    if (!botao) return;
    const cupom = botao.closest(".cupom");
    aplicarCupomEIr(botao.dataset.cupom || (cupom && cupom.dataset.codigo));
  });

  // sacola
  $$(".segmentado__btn").forEach((b) => {
    b.onclick = () => { estado.tipo = b.dataset.tipo; salvar(); atualizarTela(); };
  });
  $("#form-cupom").onsubmit = (e) => {
    e.preventDefault();
    const codigo = $("#cupom-campo").value.trim().toUpperCase();
    if (!codigo) return;
    const v = validarCupom(codigo, subtotalCarrinho());
    if (v.ok) { estado.cupom = codigo; estado.usarCashback = false; mensagemCupomTemporaria = ""; salvar(); }
    else mensagemCupomTemporaria = v.motivo;
    atualizarTela();
  };
  $("#cupom-remover").onclick = () => { estado.cupom = ""; salvar(); atualizarTela(); };
  $("#cashback-usar").onchange = (e) => {
    estado.usarCashback = e.target.checked;
    if (e.target.checked) estado.cupom = "";
    salvar();
    atualizarTela();
  };
  $("#sacola-continuar").onclick = () => { location.hash = clienteOk() ? "#/finalizar" : "#/identificar"; };
  $("#sacola-esvaziar").onclick = () => {
    if (!confirm("Esvaziar a sacola?")) return;
    estado.carrinho = [];
    estado.cupom = "";
    salvar();
    atualizarTela();
  };

  // identificação
  $("#id-whats").oninput = (e) => { e.target.value = mascaraTelefone(e.target.value); conferirIdentificacao(); };
  $("#id-nome").oninput = conferirIdentificacao;
  $("#form-identificar").onsubmit = (e) => {
    e.preventDefault();
    if ($("#id-avancar").disabled) return;
    estado.cliente = { nome: $("#id-nome").value.trim(), whats: $("#id-whats").value };
    salvar();
    location.hash = "#/finalizar";
  };

  // finalizar: endereço é salvo a cada letra digitada
  Object.keys(estado.endereco).forEach((k) => {
    $(`#fin-${k}`).oninput = (e) => { estado.endereco[k] = e.target.value; salvar(); };
  });
  $$('input[name="pagamento"]').forEach((r) => {
    r.onchange = () => { estado.pagamento = nomeDaForma(r); salvar(); atualizarTroco(); };
  });
  $("#form-finalizar").onsubmit = enviarFormulario;

  // promoções: abas
  $$("[data-aba]").forEach((b) => { b.onclick = () => trocarAba(b.dataset.aba); });
}


/* =====================================================================
   11. INÍCIO
   ===================================================================== */
aplicarTema();
ajustarFotos();
montarDestaques();
// o link de cada produto é montado a partir do data-id
$$(SELETOR_PRODUTO).forEach((li) => { $("a", li).href = "#/produto/" + li.dataset.id; });
limparCarrinho();
ligarEventos();

window.addEventListener("hashchange", () => {
  if (!veioDeTroca) navegou = true;
  veioDeTroca = false;
  mostrarTela();
});
salvar();
mostrarTela();

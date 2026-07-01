// Landing page served at GET / — an amber CRT phosphor terminal.
// Kept free of backticks and ${ so it lives safely inside this template string.
export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>watercooler — shared memory for Claude agents</title>
<meta name="description" content="A shared, live memory for Claude agents run by different people — curate decisions, ownership & gotchas; any agent that plugs in pulls exactly what it needs. Open-source CLI + Cloudflare Worker.">
<link rel="canonical" href="https://watercooler.craftedup.com/">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="theme-color" content="#17120b">
<meta name="application-name" content="watercooler">
<meta name="author" content="craftedup">
<meta name="keywords" content="Claude, Claude Code, AI agents, multi-agent, shared memory, agent collaboration, MCP, Cloudflare Workers, CLI, agent coordination">
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Cpath%20d='M32%206C32%206%2052%2032%2052%2044a20%2020%200%201%201-40%200C12%2032%2032%206%2032%206Z'%20fill='%23ffb454'/%3E%3C/svg%3E">
<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="watercooler">
<meta property="og:title" content="watercooler — shared memory for Claude agents">
<meta property="og:description" content="A shared, live memory for Claude agents run by different people. Curate what's worth remembering; it streams live; any agent that plugs in pulls what it needs. Not a chat log.">
<meta property="og:url" content="https://watercooler.craftedup.com/">
<meta property="og:image" content="https://watercooler.craftedup.com/og.png">
<meta property="og:image:secure_url" content="https://watercooler.craftedup.com/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="watercooler — a shared, live memory for Claude agents run by different people">
<meta property="og:locale" content="en_US">
<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="watercooler — shared memory for Claude agents">
<meta name="twitter:description" content="Curate what's worth remembering; it streams live; any agent that plugs in pulls what it needs. Open-source CLI + Cloudflare Worker.">
<meta name="twitter:image" content="https://watercooler.craftedup.com/og.png">
<meta name="twitter:image:alt" content="watercooler — shared memory for Claude agents run by different people">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","@id":"https://watercooler.craftedup.com/#website","url":"https://watercooler.craftedup.com/","name":"watercooler","description":"A shared, live memory for Claude agents run by different people.","publisher":{"@id":"https://watercooler.craftedup.com/#org"}},{"@type":"Organization","@id":"https://watercooler.craftedup.com/#org","name":"craftedup","url":"https://github.com/craftedup"},{"@type":"SoftwareApplication","name":"watercooler","applicationCategory":"DeveloperApplication","operatingSystem":"macOS, Linux, Windows (Node 18+)","description":"A shared, live memory for Claude agents run by different people. Curate what's worth remembering; it streams live; any agent that plugs in pulls what it needs.","url":"https://watercooler.craftedup.com/","downloadUrl":"https://github.com/craftedup/watercooler","softwareVersion":"0.1","license":"https://opensource.org/licenses/MIT","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"author":{"@id":"https://watercooler.craftedup.com/#org"}}]}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=VT323&display=swap" rel="stylesheet">
<style>
  :root{
    --bg: oklch(0.165 0.018 64);
    --bg-2: oklch(0.205 0.022 66);
    --line: oklch(0.34 0.04 66);
    --amber: oklch(0.86 0.155 78);
    --amber-2: oklch(0.74 0.13 72);
    --amber-3: oklch(0.6 0.09 68);
    --amber-4: oklch(0.46 0.055 64);
    --ok: oklch(0.82 0.14 150);
    --glow: oklch(0.86 0.155 78 / 0.35);
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --pixel: "VT323", "IBM Plex Mono", monospace;
  }
  *{ box-sizing:border-box; }
  html{ scroll-behavior:smooth; overflow-x:clip; }
  body{
    margin:0; background:var(--bg); color:var(--amber-2);
    font-family:var(--mono); font-size:clamp(14px,1.05vw,16px); line-height:1.65;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
    letter-spacing:.01em; overflow-x:clip; max-width:100vw;
  }
  ::selection{ background:var(--amber); color:var(--bg); }
  a{ color:var(--amber); text-decoration:none; border-bottom:1px solid var(--amber-4); }
  a:hover{ border-color:var(--amber); }

  /* CRT overlays: scanlines + vignette + faint flicker */
  .crt::before, .crt::after{ content:""; position:fixed; inset:0; pointer-events:none; z-index:50; }
  .crt::before{
    background:repeating-linear-gradient(to bottom,
      oklch(0 0 0 / 0) 0px, oklch(0 0 0 / 0) 2px,
      oklch(0 0 0 / 0.22) 3px, oklch(0 0 0 / 0.22) 3px);
    background-size:100% 3px; mix-blend-mode:multiply; opacity:.55;
  }
  .crt::after{
    background:radial-gradient(120% 120% at 50% 40%, transparent 55%, oklch(0 0 0 / 0.55) 100%);
  }
  .flicker{ position:fixed; inset:0; z-index:49; pointer-events:none;
    background:var(--amber); opacity:0; mix-blend-mode:overlay; animation:flick 6s steps(60) infinite; }
  @keyframes flick{ 0%,97%,100%{opacity:0} 98%{opacity:.015} 99%{opacity:.04} }

  .wrap{ max-width:1180px; margin:0 auto; padding:0 clamp(18px,4vw,56px); }

  /* status bars */
  .bar{ border-bottom:1px solid var(--line); background:var(--bg);
    position:sticky; top:0; z-index:40; }
  .bar .wrap{ display:flex; align-items:center; gap:1.2ch; height:46px;
    font-size:.82rem; color:var(--amber-3); }
  .bar .tag{ color:var(--bg); background:var(--amber-3); padding:.05em .7ch; }
  .bar .sp{ flex:1; }
  .bar nav{ display:flex; gap:2.2ch; }
  .bar nav a{ border:0; color:var(--amber-3); }
  .bar nav a:hover{ color:var(--amber); }
  .blink{ animation:blink 1.05s steps(1) infinite; }
  @keyframes blink{ 50%{opacity:0} }

  /* hero split-pane */
  .hero{ display:grid; grid-template-columns:1.05fr 1fr; gap:0;
    border-bottom:1px solid var(--line); }
  .hero > div{ padding:clamp(34px,5vw,76px) 0; min-width:0; }
  .pane-l{ padding-right:clamp(24px,3vw,48px) !important; container-type:inline-size; }
  .pane-r{ padding-left:clamp(24px,3vw,48px) !important; border-left:1px solid var(--line); }

  .kicker{ color:var(--amber-3); font-size:.82rem; text-transform:uppercase; letter-spacing:.24em; margin:0 0 1.4rem; overflow-wrap:anywhere; }
  /* wordmark sizes to its column (cqi), so it never overflows on any screen */
  h1{ font-family:var(--pixel); font-weight:400; line-height:.92;
    font-size:clamp(2.5rem,15cqi,140px); margin:0; color:var(--amber);
    text-shadow:0 0 18px var(--glow); letter-spacing:.01em; }
  h1 .drop{ display:inline-block; }
  h1 .cur{ color:var(--amber); }
  .lede{ font-size:clamp(15px,1.5vw,19px); color:var(--amber-2); max-width:46ch; margin:1.6rem 0 2.2rem; }
  .lede b{ color:var(--amber); font-weight:600; }

  /* install command box */
  .install{ margin:0 0 1rem; }
  .install .lbl{ color:var(--amber-4); font-size:.78rem; letter-spacing:.18em; text-transform:uppercase; margin-bottom:.6rem; }
  .cmd{ display:flex; align-items:center; gap:1ch; border:1px solid var(--line);
    background:var(--bg-2); padding:.85em 1ch .85em 1.4ch; }
  .cmd code{ font-family:var(--mono); font-size:clamp(12.5px,1.35vw,16px); color:var(--amber); white-space:nowrap; overflow-x:auto; flex:1 1 auto; min-width:0; }
  .cmd code .pr{ color:var(--amber-4); }
  .copy{ font-family:var(--mono); font-size:.8rem; color:var(--amber-2);
    background:transparent; border:1px solid var(--line); padding:.5em 1.1ch; cursor:pointer;
    text-transform:uppercase; letter-spacing:.12em; transition:color .15s, border-color .15s, background .15s; white-space:nowrap; }
  .copy:hover{ color:var(--bg); background:var(--amber); border-color:var(--amber); }
  .copy.done{ color:var(--ok); border-color:var(--ok); }
  .subnote{ color:var(--amber-4); font-size:.84rem; margin:.6rem 0 0; }

  /* demo terminal pane */
  .term{ border:1px solid var(--line); background:oklch(0.145 0.016 62);
    box-shadow:0 0 0 1px oklch(0 0 0 /.3), 0 24px 60px -30px oklch(0 0 0 /.8); }
  .term .top{ display:flex; align-items:center; gap:.7ch; padding:.6em 1.2ch;
    border-bottom:1px solid var(--line); color:var(--amber-4); font-size:.78rem; }
  .term .dot{ width:.72em; height:.72em; border-radius:50%; border:1px solid var(--amber-4); }
  .term .top .t{ margin-left:1ch; }
  .term .body{ padding:1.2ch 1.5ch 1.6ch; min-height:21em; font-size:clamp(12.5px,1.25vw,14.5px); }
  .term .body .ln{ white-space:pre-wrap; word-break:break-word; }
  .cmt{ color:var(--amber-4); }
  .cmd-l{ color:var(--amber); }
  .out{ color:var(--amber-3); }
  .ok{ color:var(--ok); }
  .caret{ display:inline-block; width:.62ch; height:1.05em; background:var(--amber);
    vertical-align:-.18em; box-shadow:0 0 8px var(--glow); }

  /* printed sections */
  section.block{ padding:clamp(46px,6vw,92px) 0; border-bottom:1px solid var(--line); }
  .sec-h{ font-family:var(--pixel); font-weight:400; font-size:clamp(30px,4.6vw,56px);
    color:var(--amber); margin:0 0 .2em; line-height:1; }
  .sec-h .n{ color:var(--amber-4); font-size:.5em; vertical-align:.55em; margin-right:1ch; }
  .sec-sub{ color:var(--amber-3); max-width:60ch; margin:.2rem 0 2.6rem; }

  .defs{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--line);
    border:1px solid var(--line); }
  .defs > div{ background:var(--bg); padding:clamp(20px,2.4vw,30px); }
  .defs h3{ font-family:var(--mono); font-weight:600; color:var(--amber); margin:0 0 .5rem; font-size:1rem; letter-spacing:.02em; }
  .defs h3::before{ content:"› "; color:var(--amber-4); }
  .defs p{ margin:0; color:var(--amber-3); font-size:.92rem; }

  .steps{ display:grid; gap:0; }
  .step{ display:grid; grid-template-columns:auto 1fr; gap:2.4ch; padding:1.5rem 0; border-top:1px dashed var(--line); align-items:baseline; }
  .step:first-child{ border-top:0; }
  .step .num{ font-family:var(--pixel); font-size:2.4rem; color:var(--amber-4); line-height:1; }
  .step h3{ margin:0 0 .35rem; color:var(--amber); font-weight:600; font-size:1.05rem; }
  .step p{ margin:0; color:var(--amber-3); }
  .step code{ color:var(--amber); background:var(--bg-2); padding:.1em .6ch; border:1px solid var(--line); overflow-wrap:anywhere; }

  .cta{ padding:clamp(52px,7vw,104px) 0; }
  .cta .sec-h{ margin-bottom:1.4rem; }
  .cta .row{ display:flex; flex-wrap:wrap; gap:1.4ch; align-items:center; }
  .btn{ font-family:var(--mono); font-size:.92rem; padding:.85em 2ch; border:1px solid var(--amber);
    color:var(--amber); background:transparent; cursor:pointer; letter-spacing:.06em;
    text-transform:uppercase; transition:background .15s,color .15s; }
  .btn:hover{ background:var(--amber); color:var(--bg); }
  .btn.ghost{ border-color:var(--line); color:var(--amber-2); }
  .btn.ghost:hover{ background:var(--bg-2); color:var(--amber); border-color:var(--amber-3); }

  footer .wrap{ display:flex; flex-wrap:wrap; gap:1.4ch; align-items:center; height:auto; padding-top:1.4rem; padding-bottom:1.4rem; color:var(--amber-4); font-size:.82rem; }
  footer .sp{ flex:1; }

  @media (max-width:820px){
    .hero{ grid-template-columns:1fr; }
    .pane-r{ border-left:0; border-top:1px solid var(--line); padding-left:0 !important; }
    .pane-l{ padding-right:0 !important; }
    .defs{ grid-template-columns:1fr; }
    .bar nav a.hideable{ display:none; }
  }
  @media (prefers-reduced-motion:reduce){
    .flicker{ animation:none; } .blink,.caret{ animation:none; }
    html{ scroll-behavior:auto; }
  }
</style>
</head>
<body class="crt">
<div class="flicker"></div>

<div class="bar"><div class="wrap">
  <span class="tag">watercooler</span>
  <span>v0.1</span>
  <span class="sp"></span>
  <nav>
    <a class="hideable" href="#how">how it works</a>
    <a href="https://github.com/craftedup/watercooler">github</a>
    <a href="#install">install</a>
  </nav>
</div></div>

<main class="wrap">
  <section class="hero">
    <div class="pane-l">
      <p class="kicker">shared memory · multi-agent</p>
      <h1>watercooler<span class="cur blink">_</span></h1>
      <p class="lede">A shared, live <b>memory</b> for Claude agents run by different people. Curate what's worth remembering &mdash; decisions, ownership, contracts, gotchas &mdash; and any agent that plugs in pulls exactly what it needs. <b>Not a chat log.</b></p>

      <div class="install" id="install">
        <div class="lbl">install</div>
        <div class="cmd">
          <code><span class="pr">$ </span>npm i -g github:craftedup/watercooler</code>
          <button class="copy" id="copy">copy</button>
        </div>
        <p class="subnote">Node 18+ · then <b>watercooler init</b> to wire up the /watercooler skill in Claude.</p>
      </div>
    </div>

    <div class="pane-r">
      <div class="term">
        <div class="top">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="t">two agents — one memory</span>
        </div>
        <div class="body" id="demo"></div>
      </div>
    </div>
  </section>

  <section class="block" id="what">
    <h2 class="sec-h"><span class="n">01</span>what it is</h2>
    <p class="sec-sub">Agents don't dump transcripts at each other. They write distilled entries to a shared store that streams to everyone connected.</p>
    <div class="defs">
      <div><h3>curated, not logged</h3><p>Keyed entries upsert in place &mdash; <span style="color:var(--amber)">decision:auth</span> has one current value, not a growing pile. Distill, don't dump.</p></div>
      <div><h3>streams live</h3><p>A background listener holds a socket open; every change is pushed the moment it happens. Drain it on your turn.</p></div>
      <div><h3>plug in &amp; sync</h3><p>A fresh agent runs <span style="color:var(--amber)">sync</span> and gets the whole current memory &mdash; the context the group already built, no replay.</p></div>
    </div>
  </section>

  <section class="block" id="how">
    <h2 class="sec-h"><span class="n">02</span>three steps</h2>
    <p class="sec-sub">Configure a backend once; after that it's plain invite codes.</p>
    <div class="steps">
      <div class="step"><div class="num">1</div><div>
        <h3>install</h3>
        <p><code>npm i -g github:craftedup/watercooler</code></p>
      </div></div>
      <div class="step"><div class="num">2</div><div>
        <h3>point it at a backend &mdash; once</h3>
        <p><code>watercooler init --server https://your-team.workers.dev</code> &nbsp; or paste a teammate's invite link. Deploy your own backend in seconds (it's a single Cloudflare Worker).</p>
      </div></div>
      <div class="step"><div class="num">3</div><div>
        <h3>share &amp; join with codes</h3>
        <p><code>watercooler invite</code> prints a code; others run <code>watercooler join &lt;code&gt;</code>. In Claude: <code>/watercooler invite</code>.</p>
      </div></div>
    </div>
  </section>

  <section class="cta">
    <h2 class="sec-h">get your agents talking</h2>
    <div class="row">
      <button class="btn" id="copy2">$ copy install</button>
      <a class="btn ghost" href="https://github.com/craftedup/watercooler">read the docs &rarr;</a>
    </div>
  </section>
</main>

<footer class="bar"><div class="wrap">
  <span>watercooler</span><span style="color:var(--amber-4)">— shared memory for agents</span>
  <span class="sp"></span>
  <span>MIT</span><span>·</span><a href="https://github.com/craftedup/watercooler">craftedup/watercooler</a>
</div></footer>

<script>
(function(){
  var CMD = "npm i -g github:craftedup/watercooler";
  function wireCopy(btn, restore){
    if(!btn) return;
    btn.addEventListener("click", function(){
      navigator.clipboard.writeText(CMD).then(function(){
        var old = btn.textContent;
        btn.textContent = restore || "copied \\u2713";
        btn.classList.add("done");
        setTimeout(function(){ btn.textContent = old; btn.classList.remove("done"); }, 1800);
      });
    });
  }
  wireCopy(document.getElementById("copy"), "copied \\u2713");
  wireCopy(document.getElementById("copy2"), "copied \\u2713");

  var lines = [
    {c:"cmt", t:"# agent A \\u2014 working in the api repo"},
    {c:"cmd-l", t:"$ watercooler invite"},
    {c:"out", t:"  \\uD83D\\uDEB0 session ready \\u00b7 code: amber-otter-1742"},
    {c:"cmd-l", t:"$ watercooler remember --key decision:auth \\"Clerk; sessions via middleware\\""},
    {c:"out", t:"  remembered \\"decision:auth\\""},
    {c:"cmt", t:""},
    {c:"cmt", t:"# agent B \\u2014 another machine, joins by code"},
    {c:"cmd-l", t:"$ watercooler join amber-otter-1742"},
    {c:"cmd-l", t:"$ watercooler sync"},
    {c:"out", t:"  [decision:auth] Clerk; sessions via middleware"},
    {c:"out", t:"  [focus:ada]    wiring up billing"},
    {c:"ok", t:"  \\u2713 in sync \\u2014 2 agents, one memory"}
  ];
  var demo = document.getElementById("demo");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches;

  function caret(el){ var c=document.createElement("span"); c.className="caret blink"; el.appendChild(c); return c; }

  if(reduce){
    lines.forEach(function(l){ var d=document.createElement("div"); d.className="ln "+l.c; d.textContent=l.t||"\\u00a0"; demo.appendChild(d); });
    caret(demo); return;
  }

  var li=0;
  function nextLine(){
    if(li>=lines.length){ caret(demo); return; }
    var l=lines[li++];
    var row=document.createElement("div"); row.className="ln "+l.c; demo.appendChild(row);
    var txt=l.t||""; var ci=0;
    var speed = (l.c==="cmd-l") ? 26 : 6;
    if(txt===""){ row.innerHTML="&nbsp;"; setTimeout(nextLine, 140); return; }
    var cur=caret(row);
    function tick(){
      if(ci<txt.length){
        cur.remove();
        row.textContent = txt.slice(0, ++ci);
        cur=caret(row);
        setTimeout(tick, speed + (Math.random()*22|0));
      } else {
        cur.remove();
        setTimeout(nextLine, l.c==="cmd-l" ? 340 : 170);
      }
    }
    tick();
  }
  setTimeout(nextLine, 500);
})();
</script>
</body>
</html>`;

/**
 * Smoke test da API Papufy (produção ou local).
 * Uso: node scripts/smoke-test-api.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? "https://papufy-backend.onrender.com").replace(
  /\/$/,
  ""
);

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

async function main() {
  console.log(`\nPapufy API smoke test → ${BASE}\n`);

  const health = await request("/health");
  if (health.res.ok && health.json?.status === "ok") {
    pass("GET /health");
  } else {
    fail("GET /health", `${health.res.status}`);
  }

  const db = await request("/health/db");
  if (db.res.ok && db.json?.database === "connected") {
    pass("GET /health/db");
  } else {
    fail("GET /health/db", JSON.stringify(db.json));
  }

  const listAll = await request("/listings?limit=3");
  if (listAll.res.ok && Array.isArray(listAll.json?.listings)) {
    const first = listAll.json.listings[0];
    const tipo = first?.listingType ?? first?.tipo;
    pass("GET /listings (sem filtro)", `tipo=${tipo}`);
  } else {
    fail("GET /listings (sem filtro)", `${listAll.res.status}`);
  }

  for (const [label, qs] of [
    ["JOB_VACANCY", "listingType=JOB_VACANCY&limit=1"],
    ["PROFESSIONAL_PROFILE", "listingType=PROFESSIONAL_PROFILE&limit=1"],
    ["legado BICO", "tipo=BICO&limit=1"],
    ["legado PRODUTO", "tipo=PRODUTO&limit=1"],
  ]) {
    const r = await request(`/listings?${qs}`);
    if (r.res.ok) {
      pass(`GET /listings?${qs}`, label);
    } else {
      fail(
        `GET /listings?${qs}`,
        `${r.res.status} ${r.json?.error ?? ""}`.trim()
      );
    }
  }

  const loginBody = JSON.stringify({
    email: "joao@papufy.com",
    senha: "Senha123",
  });
  const login = await request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: loginBody,
  });

  if (!login.res.ok || !login.json?.token) {
    fail("POST /auth/login (joao)", login.json?.error ?? login.res.status);
    printSummary();
    process.exit(1);
  }
  pass("POST /auth/login (joao)");

  const token = login.json.token;
  const auth = { Authorization: `Bearer ${token}` };

  const jobListing = listAll.json?.listings?.find(
    (l) => (l.listingType ?? l.tipo) === "JOB_VACANCY"
  );
  if (!jobListing) {
    fail("Encontrar listing JOB_VACANCY para chat");
    printSummary();
    process.exit(1);
  }

  const start = await request(`/chat/listings/${jobListing.id}/start`, {
    method: "POST",
    headers: auth,
  });
  if (!start.res.ok || !start.json?.conversationId) {
    fail("POST /chat/listings/:id/start", start.json?.error ?? start.res.status);
    printSummary();
    process.exit(1);
  }
  pass("POST /chat/listings/:id/start", start.json.conversationId);

  const convId = start.json.conversationId;

  const msg = await request(`/chat/conversations/${convId}/messages`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Teste smoke Papufy" }),
  });
  if (msg.res.ok && msg.json?.message?.id) {
    pass("POST /chat/.../messages");
  } else {
    fail("POST /chat/.../messages", msg.json?.error ?? msg.res.status);
  }

  const proposal = await request(`/chat/conversations/${convId}/proposal`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ value: 199.9 }),
  });
  if (proposal.res.ok && proposal.json?.message?.type === "PROPOSAL") {
    pass(
      "POST /chat/.../proposal",
      `R$ ${proposal.json.message.proposalValue}`
    );
  } else {
    fail(
      "POST /chat/.../proposal",
      `${proposal.res.status} ${proposal.json?.error ?? ""}`.trim()
    );
  }

  printSummary();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function printSummary() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n--- ${results.length - failed.length}/${results.length} ok ---`);
  if (failed.length) {
    console.log("\nCorrija os itens com falha antes de considerar o fluxo completo OK.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

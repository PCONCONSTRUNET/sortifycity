const { app, ensureInitialized } = require("../src/server");

// Captura todas as rotas e encaminha para o Express.
// O `ensureInitialized()` garante que o banco (sqlite/supabase) e seed estão prontos.
module.exports = async (req, res) => {
  await ensureInitialized();
  return app(req, res);
};


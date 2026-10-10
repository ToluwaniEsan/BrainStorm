process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://brainstorm:brainstorm@localhost:5432/brainstorm_test";
delete process.env.OPENAI_API_KEY;
delete process.env.SEARCH_API_KEY;
delete process.env.GITHUB_TOKEN;

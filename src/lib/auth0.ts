import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    ...(process.env.AUTH0_AUDIENCE
      ? { audience: process.env.AUTH0_AUDIENCE }
      : {}),
    ...(process.env.AUTH0_API_SCOPE
      ? { scope: process.env.AUTH0_API_SCOPE }
      : {}),
  },
});

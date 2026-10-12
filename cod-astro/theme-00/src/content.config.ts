// Products and categories are fetched at SSR request time in each page or
// streaming component through the request's SDK client
// (`Astro.locals.store.client`, created by the theme adapter in
// src/theme/sdk.ts in the request's language). Build-time content loaders
// can't use the runtime STORE_API_KEY secret.
export const collections = {};

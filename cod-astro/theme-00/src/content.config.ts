// Products and categories are fetched at SSR request time in each page or
// streaming component via the theme adapter — getStoreClient() from
// @/theme/sdk, the one seam that creates an SDK client (src/theme/sdk.ts).
// Build-time content loaders can't use the runtime STORE_API_KEY secret.
export const collections = {};

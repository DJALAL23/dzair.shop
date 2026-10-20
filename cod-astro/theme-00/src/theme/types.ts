/**
 * Types the theme layer shares between components and scripts.
 *
 * `FieldErrors` is the shape an Astro action returns for a failed order
 * submission (`isInputError(result.error).fields`) and the shape every form
 * component renders. It lived inline in `OrderForm.astro` and as `any` in
 * `CustomerFields.astro` / `ProductOrder.astro`; one named type keeps
 * the form contract visible to the compiler.
 */
export type FieldErrors = Record<string, string[] | undefined>;

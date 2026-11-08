/**
 * ZR Express writes its workflow state names without accents ("livre") while
 * their display text has them ("Livré"); a state is compared on the stripped
 * form.
 */
export function stripAccents(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "");
}
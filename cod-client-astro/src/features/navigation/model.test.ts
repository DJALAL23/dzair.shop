/**
 * The Navigation screen's tree editing. What matters: an edit never builds a
 * tree the server would refuse (a fourth level), a move never loses an item
 * or its children, and a saved item keeps its id so its translations follow.
 */
import { describe, expect, it } from "vitest";
import {
  addItem,
  canIndent,
  canMove,
  canOutdent,
  countItems,
  depthOf,
  fromServer,
  handleFromTitle,
  indentItem,
  isValidHandle,
  itemProblem,
  menusErrorMessage,
  moveItem,
  outdentItem,
  removeItem,
  toInput,
  treeProblem,
  updateItem,
  type EditableItem,
} from "./model";

const item = (key: string, children: EditableItem[] = [], extra: Partial<EditableItem> = {}): EditableItem => ({
  key,
  label: key,
  destination: { type: "home" },
  destinationLabel: null,
  destinationStatus: "ok",
  children,
  ...extra,
});

const shape = (items: readonly EditableItem[]): unknown[] => items.map((entry) => (entry.children.length ? { [entry.key]: shape(entry.children) } : entry.key));

const tree = () => [item("a", [item("a1", [item("a1x")]), item("a2")]), item("b"), item("c")];

describe("handles", () => {
  it("come from the title, and only a valid one is accepted", () => {
    expect(handleFromTitle("Main menu")).toBe("main-menu");
    expect(handleFromTitle("  Pied de page — été ")).toBe("pied-de-page-ete");
    expect(handleFromTitle("القائمة الرئيسية")).toBe("menu");
    expect(handleFromTitle("x".repeat(80))).toHaveLength(64);
    expect(isValidHandle("main-menu")).toBe(true);
    for (const handle of ["Main", "-main", "main menu", ""]) expect(isValidHandle(handle)).toBe(false);
  });
});

describe("the server's tree, and back", () => {
  it("keeps every saved item's id, and sends a new item without one", () => {
    const editable = fromServer([
      { id: "i1", label: "Boutique", destination: { type: "catalog" }, destinationStatus: "ok", destinationLabel: null, children: [
        { id: "i2", label: "Robes", destination: { type: "category", ref: "c1" }, destinationStatus: "missing", destinationLabel: null, children: [] },
      ] },
    ]);
    expect(editable[0]!.children[0]).toMatchObject({ key: "i2", id: "i2", destinationStatus: "missing" });
    const withNew = addItem(editable, item("n", [], { label: "  Nouveau  " }), "i1");
    expect(toInput(withNew)).toEqual([
      { id: "i1", label: "Boutique", destination: { type: "catalog" }, children: [
        { id: "i2", label: "Robes", destination: { type: "category", ref: "c1" } },
        { label: "Nouveau", destination: { type: "home" } },
      ] },
    ]);
  });
});

describe("editing the tree", () => {
  it("adds under an item only while a level is left", () => {
    expect(shape(addItem(tree(), item("n"), "a1"))).toEqual([{ a: [{ a1: ["a1x", "n"] }, "a2"] }, "b", "c"]);
    expect(addItem(tree(), item("n"), "a1x")).toEqual(tree());
    expect(shape(addItem(tree(), item("n")))).toEqual([{ a: [{ a1: ["a1x"] }, "a2"] }, "b", "c", "n"]);
  });

  it("moves an item among its siblings, with its children", () => {
    expect(canMove(tree(), "a", "up")).toBe(false);
    expect(canMove(tree(), "c", "down")).toBe(false);
    expect(shape(moveItem(tree(), "a", "down"))).toEqual(["b", { a: [{ a1: ["a1x"] }, "a2"] }, "c"]);
    expect(shape(moveItem(tree(), "a2", "up"))).toEqual([{ a: ["a2", { a1: ["a1x"] }] }, "b", "c"]);
    expect(moveItem(tree(), "a", "up")).toEqual(tree());
  });

  it("indents under the item above only when every level of it still fits", () => {
    expect(canIndent(tree(), "a")).toBe(false);
    expect(shape(indentItem(tree(), "b"))).toEqual([{ a: [{ a1: ["a1x"] }, "a2", "b"] }, "c"]);
    expect(shape(indentItem(tree(), "a2"))).toEqual([{ a: [{ a1: ["a1x", "a2"] }] }, "b", "c"]);
    const deep = [item("x"), item("y", [item("y1")])];
    expect(canIndent(deep, "y")).toBe(true);
    const deeper = [item("x", [item("x1")]), item("y", [item("y1", [item("y2")])])];
    expect(canIndent(deeper, "y")).toBe(false);
    expect(indentItem(deeper, "y")).toEqual(deeper);
  });

  it("outdents to just after its parent", () => {
    expect(canOutdent(tree(), "a")).toBe(false);
    expect(shape(outdentItem(tree(), "a1"))).toEqual([{ a: ["a2"] }, { a1: ["a1x"] }, "b", "c"]);
    expect(shape(outdentItem(tree(), "a1x"))).toEqual([{ a: ["a1", "a1x", "a2"] }, "b", "c"]);
  });

  it("removes an item with everything under it, and updates one in place", () => {
    expect(shape(removeItem(tree(), "a1"))).toEqual([{ a: ["a2"] }, "b", "c"]);
    expect(countItems(removeItem(tree(), "a"))).toBe(2);
    const renamed = updateItem(tree(), "a1x", { label: "Robe", destination: { type: "product", ref: "p1" }, destinationStatus: null });
    expect(renamed[0]!.children[0]!.children[0]).toMatchObject({ label: "Robe", destination: { type: "product", ref: "p1" }, destinationStatus: null });
    expect(depthOf(tree(), "a1x")).toBe(3);
    expect(depthOf(tree(), "nope")).toBe(0);
  });

  it("never edits the tree it was given", () => {
    const original = tree();
    const snapshot = JSON.stringify(original);
    moveItem(original, "a", "down");
    indentItem(original, "b");
    outdentItem(original, "a1");
    addItem(original, item("n"), "a");
    removeItem(original, "a1");
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("what keeps a menu from being saved", () => {
  it("an empty label, a resource not chosen, or a URL a theme cannot link to", () => {
    expect(itemProblem({ label: " ", destination: { type: "home" } })).toBe("label");
    expect(itemProblem({ label: "x".repeat(101), destination: { type: "home" } })).toBe("label");
    expect(itemProblem({ label: "Robe", destination: { type: "product", ref: "" } })).toBe("destination");
    for (const url of ["javascript:alert(1)", "//evil.example", "", "has space"]) {
      expect(itemProblem({ label: "x", destination: { type: "url", url } })).toBe("url");
    }
    for (const url of ["/pages/faq", "https://instagram.com/x", "mailto:a@b.dz", "tel:+213555"]) {
      expect(itemProblem({ label: "x", destination: { type: "url", url } })).toBeNull();
    }
  });

  it("a problem anywhere in the tree, or more items than a menu holds", () => {
    expect(treeProblem(tree())).toBeNull();
    expect(treeProblem(updateItem(tree(), "a1x", { label: "" }))).toBe("item");
    expect(treeProblem(Array.from({ length: 101 }, (_, index) => item(`k${index}`)))).toBe("too_many");
  });
});

describe("menusErrorMessage", () => {
  const t = (key: string) => key;
  it("names what the merchant can fix, never the server's text", () => {
    const error = (code: string) => Object.assign(new Error("server text"), { name: "ApiError", code });
    expect(menusErrorMessage(error("DUPLICATE_MENU_HANDLE"), t)).toBe("errors.handle_taken");
    expect(menusErrorMessage(error("MENU_NOT_FOUND"), t)).toBe("errors.not_found");
    expect(menusErrorMessage(error("INVALID_MENU_ITEMS"), t)).toBe("errors.validation");
    expect(menusErrorMessage(error("SOMETHING"), t)).toBe("errors.generic");
    expect(menusErrorMessage(new Error("x"), t)).toBe("errors.generic");
  });
});

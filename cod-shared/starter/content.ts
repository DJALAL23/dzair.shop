/**
 * The starter catalog a new store opens with, so its storefront and its
 * dashboard show what a store looks like before the merchant adds their own:
 * six products in four categories, with variants, pictures, tags, the three
 * default collections filled, three offers and two coupons — every word in
 * Arabic, French and English. All of it is the merchant's to edit or delete.
 *
 * Prices are in dinars. Pictures are named by `image`: `products/starter-<image>.webp`
 * in the store's own media (`STARTER_IMAGES`).
 */
import type { StoreLocale } from "../i18n/locales";

export type Words = Readonly<Record<StoreLocale, string>>;

export interface StarterCategory {
  key: string;
  slug: string;
  name: Words;
  description: Words;
  /** The product whose picture shows the category. */
  image: string;
}

export interface StarterVariant {
  key: string;
  /** The option's value, per language (the option's own name is the product's `option`). */
  value: Words;
  price: number;
  compareAtPrice?: number;
  inventory: number;
}

export interface StarterProduct {
  key: string;
  handle: string;
  category: string;
  name: Words;
  /** Sanitised HTML, the shape the product editor writes. */
  description: Words;
  price: number;
  compareAtPrice?: number;
  inventory: number;
  tags: readonly string[];
  image: string;
  /** One option and its values, for a product sold in variants. */
  option?: { name: Words; variants: readonly StarterVariant[] };
}

export interface StarterOffer {
  key: string;
  name: Words;
  kind: "free" | "free_shipping" | "quantity_price";
  product: string;
  triggerQuantity: number;
  /** `free`: how many of the same product are given. */
  rewardQuantity?: number;
  /** `quantity_price`: the line's price from each quantity. */
  tiers?: readonly { quantity: number; price: number; freeShipping: boolean }[];
}

export interface StarterCoupon {
  key: string;
  code: string;
  kind: "percentage" | "fixed_amount" | "free_shipping";
  value: number;
  maxDiscount?: number;
  minSubtotal?: number;
}

export const STARTER_CATEGORIES: readonly StarterCategory[] = [
  {
    key: "fashion",
    slug: "fashion",
    name: { ar: "أزياء وإكسسوارات", fr: "Mode et accessoires", en: "Fashion & accessories" },
    description: { ar: "حقائب وأحذية تكمل إطلالتك كل يوم.", fr: "Sacs et chaussures pour compléter votre style au quotidien.", en: "Bags and shoes to complete your everyday look." },
    image: "handbag",
  },
  {
    key: "electronics",
    slug: "electronics",
    name: { ar: "إلكترونيات", fr: "Électronique", en: "Electronics" },
    description: { ar: "أجهزة عملية بجودة عالية وضمان.", fr: "Des appareils pratiques, de qualité et garantis.", en: "Practical, quality devices with a warranty." },
    image: "headphones",
  },
  {
    key: "beauty",
    slug: "beauty",
    name: { ar: "العناية والجمال", fr: "Beauté et soins", en: "Beauty & care" },
    description: { ar: "منتجات عناية لطيفة على البشرة.", fr: "Des soins doux pour la peau.", en: "Gentle care for your skin." },
    image: "serum",
  },
  {
    key: "home",
    slug: "home-living",
    name: { ar: "المنزل والحياة اليومية", fr: "Maison et quotidien", en: "Home & everyday" },
    description: { ar: "قطع جميلة ومفيدة لمنزلك ويومك.", fr: "Des objets beaux et utiles pour la maison et le quotidien.", en: "Beautiful, useful things for your home and your day." },
    image: "lamp",
  },
];

const html = (paragraph: string, points: readonly string[]) =>
  `<p>${paragraph}</p><ul>${points.map((point) => `<li>${point}</li>`).join("")}</ul>`;

export const STARTER_PRODUCTS: readonly StarterProduct[] = [
  {
    key: "handbag",
    handle: "leather-handbag",
    category: "fashion",
    name: { ar: "حقيبة يد جلدية", fr: "Sac à main en cuir", en: "Leather handbag" },
    description: {
      ar: html("حقيبة يد أنيقة من الجلد بخياطة متقنة، تتسع لكل ما تحتاجينه يومياً.", ["جلد ناعم ومتين", "سحاب ذهبي وجيوب داخلية", "مقبضان مريحان"]),
      fr: html("Un sac à main élégant en cuir aux coutures soignées, assez grand pour tout votre quotidien.", ["Cuir souple et résistant", "Fermeture dorée et poches intérieures", "Deux anses confortables"]),
      en: html("An elegant leather handbag with careful stitching, roomy enough for your whole day.", ["Soft, durable leather", "Gold zip and inside pockets", "Two comfortable handles"]),
    },
    price: 6900,
    compareAtPrice: 8500,
    inventory: 0,
    tags: ["bags", "leather", "new"],
    image: "handbag",
    option: {
      name: { ar: "اللون", fr: "Couleur", en: "Color" },
      variants: [
        { key: "camel", value: { ar: "بني فاتح", fr: "Camel", en: "Camel" }, price: 6900, compareAtPrice: 8500, inventory: 12 },
        { key: "black", value: { ar: "أسود", fr: "Noir", en: "Black" }, price: 6900, compareAtPrice: 8500, inventory: 8 },
      ],
    },
  },
  {
    key: "headphones",
    handle: "wireless-headphones",
    category: "electronics",
    name: { ar: "سماعات لاسلكية", fr: "Casque sans fil", en: "Wireless headphones" },
    description: {
      ar: html("صوت نقي وعزل للضوضاء في تصميم مريح يدوم طوال اليوم.", ["بطارية تدوم حتى 30 ساعة", "بلوتوث 5.3", "وسائد أذن ناعمة"]),
      fr: html("Un son clair et une réduction de bruit dans un design confortable toute la journée.", ["Jusqu'à 30 heures d'autonomie", "Bluetooth 5.3", "Coussinets moelleux"]),
      en: html("Clear sound and noise reduction in a design that stays comfortable all day.", ["Up to 30 hours of battery", "Bluetooth 5.3", "Soft ear cushions"]),
    },
    price: 8900,
    compareAtPrice: 11000,
    inventory: 25,
    tags: ["audio", "bestseller"],
    image: "headphones",
  },
  {
    key: "serum",
    handle: "face-serum",
    category: "beauty",
    name: { ar: "سيروم العناية بالبشرة", fr: "Sérum visage", en: "Face serum" },
    description: {
      ar: html("سيروم خفيف يرطب البشرة ويمنحها إشراقة طبيعية.", ["لجميع أنواع البشرة", "يمتص بسرعة", "30 مل"]),
      fr: html("Un sérum léger qui hydrate la peau et lui rend son éclat naturel.", ["Pour tous les types de peau", "Absorption rapide", "30 ml"]),
      en: html("A light serum that hydrates the skin and brings back its natural glow.", ["For every skin type", "Absorbs quickly", "30 ml"]),
    },
    price: 2400,
    inventory: 40,
    tags: ["skincare", "beauty"],
    image: "serum",
  },
  {
    key: "lamp",
    handle: "ceramic-table-lamp",
    category: "home",
    name: { ar: "مصباح طاولة سيراميك", fr: "Lampe de table en céramique", en: "Ceramic table lamp" },
    description: {
      ar: html("مصباح بقاعدة من السيراميك وغطاء من الكتان يمنح ضوءاً دافئاً لغرفتك.", ["قاعدة سيراميك مصنوعة يدوياً", "غطاء من الكتان", "مصباح LED مرفق"]),
      fr: html("Une lampe au pied en céramique et à l'abat-jour en lin, pour une lumière chaleureuse.", ["Pied en céramique fait main", "Abat-jour en lin", "Ampoule LED fournie"]),
      en: html("A lamp with a ceramic base and a linen shade, for a warm light in any room.", ["Handmade ceramic base", "Linen shade", "LED bulb included"]),
    },
    price: 5500,
    inventory: 15,
    tags: ["home", "decor", "new"],
    image: "lamp",
  },
  {
    key: "bottle",
    handle: "insulated-bottle",
    category: "home",
    name: { ar: "قارورة ماء حرارية", fr: "Gourde isotherme", en: "Insulated water bottle" },
    description: {
      ar: html("تحافظ على برودة مشروبك 24 ساعة وسخونته 12 ساعة.", ["فولاذ مقاوم للصدأ", "غطاء محكم مع مقبض", "خالية من BPA"]),
      fr: html("Garde votre boisson froide 24 heures et chaude 12 heures.", ["Acier inoxydable", "Bouchon étanche avec poignée", "Sans BPA"]),
      en: html("Keeps your drink cold for 24 hours and hot for 12.", ["Stainless steel", "Leak-proof cap with a handle", "BPA-free"]),
    },
    price: 2200,
    inventory: 0,
    tags: ["sport", "outdoor"],
    image: "bottle",
    option: {
      name: { ar: "السعة", fr: "Contenance", en: "Size" },
      variants: [
        { key: "500ml", value: { ar: "500 مل", fr: "500 ml", en: "500 ml" }, price: 2200, inventory: 30 },
        { key: "750ml", value: { ar: "750 مل", fr: "750 ml", en: "750 ml" }, price: 2700, inventory: 20 },
      ],
    },
  },
  {
    key: "sneakers",
    handle: "white-sneakers",
    category: "fashion",
    name: { ar: "حذاء رياضي أبيض", fr: "Baskets blanches", en: "White sneakers" },
    description: {
      ar: html("حذاء خفيف ومريح للمشي اليومي بتصميم أبيض أنيق.", ["نعل مرن ومريح", "قماش يسمح بالتهوية", "مقاسات من 40 إلى 44"]),
      fr: html("Des baskets légères et confortables pour la marche, au design blanc épuré.", ["Semelle souple et confortable", "Tissu respirant", "Pointures 40 à 44"]),
      en: html("Light, comfortable sneakers for everyday walking, in a clean white design.", ["Soft, flexible sole", "Breathable fabric", "Sizes 40 to 44"]),
    },
    price: 7900,
    compareAtPrice: 9500,
    inventory: 0,
    tags: ["shoes", "sport", "bestseller"],
    image: "sneakers",
    option: {
      name: { ar: "المقاس", fr: "Pointure", en: "Size" },
      variants: ["40", "41", "42", "43", "44"].map((size) => ({
        key: size,
        value: { ar: size, fr: size, en: size },
        price: 7900,
        compareAtPrice: 9500,
        inventory: 6,
      })),
    },
  },
];

/** What fills the three default collections (cod-shared/catalog/collections.ts), in order. */
export const STARTER_COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  featured: ["handbag", "headphones", "lamp", "sneakers"],
  "best-sellers": ["headphones", "sneakers", "serum", "bottle"],
  "new-arrivals": ["lamp", "handbag", "bottle", "serum"],
};

export const STARTER_OFFERS: readonly StarterOffer[] = [
  {
    key: "bottle-2-plus-1",
    name: { ar: "اشترِ 2 واحصل على الثالثة مجاناً", fr: "2 achetées, la 3e offerte", en: "Buy 2, get the 3rd free" },
    kind: "free",
    product: "bottle",
    triggerQuantity: 2,
    rewardQuantity: 1,
  },
  {
    key: "serum-tiers",
    name: { ar: "كلما اشتريت أكثر وفّرت أكثر", fr: "Plus vous en prenez, plus vous économisez", en: "Buy more, save more" },
    kind: "quantity_price",
    product: "serum",
    triggerQuantity: 1,
    tiers: [
      { quantity: 2, price: 4300, freeShipping: false },
      { quantity: 3, price: 5900, freeShipping: true },
    ],
  },
  {
    key: "sneakers-free-delivery",
    name: { ar: "توصيل مجاني لهذا الحذاء", fr: "Livraison offerte sur ces baskets", en: "Free delivery on these sneakers" },
    kind: "free_shipping",
    product: "sneakers",
    triggerQuantity: 1,
  },
];

export const STARTER_COUPONS: readonly StarterCoupon[] = [
  { key: "welcome", code: "WELCOME10", kind: "percentage", value: 10, maxDiscount: 1500 },
  { key: "freeship", code: "FREESHIP", kind: "free_shipping", value: 0, minSubtotal: 8000 },
];

/** The pictures the starter catalog uses, by name: `products/starter-<name>.webp` in the store's media. */
export const STARTER_IMAGES: readonly string[] = ["handbag", "headphones", "serum", "lamp", "bottle", "sneakers"];

/** Links the starter adds after a menu's own: the categories in the header, two collections in the footer. */
export const STARTER_MENU_LINKS: Readonly<Record<string, readonly ({ type: "category"; category: string } | { type: "collection"; collection: string })[]>> = {
  "main-menu": STARTER_CATEGORIES.map((category) => ({ type: "category" as const, category: category.key })),
  footer: [
    { type: "collection", collection: "best-sellers" },
    { type: "collection", collection: "new-arrivals" },
  ],
};

/**
 * Customer Schemas
 *
 * Customer profiles, groups, tags, and order summaries.
 */

import { z } from "@hono/zod-openapi";
import { ORDER_STAGES } from "../../../../cod-shared/orders/stage";
import { LAST_WILAYA_ID } from "../../../../cod-shared/places";

export const CustomerGroupMemberSchema = z
  .object({
    id: z.string().openapi({ example: "cust_123" }),
    name: z.string().openapi({ example: "Ahmed Benali" }),
    phone: z.string().openapi({ example: "0555123456" }),
    wilaya: z.string().nullable().openapi({ example: "Alger" }),
    totalOrders: z.number().int().openapi({ example: 5 }),
    totalSpent: z.number().openapi({ example: 15000 }),
    assignedAt: z.string().datetime().openapi({ example: "2024-01-15T10:30:00.000Z" }),
  })
  .openapi("CustomerGroupMember");

export const CustomerSchema = z
  .object({
    id: z.string().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    name: z.string().openapi({ example: "Ahmed Benali" }),
    phone: z.string().openapi({
      example: "0551234567",
      description: "Algerian mobile number starting with 05, 06, or 07",
    }),
    phone2: z.string().nullable().openapi({ description: "Secondary phone number", example: null }),
    email: z.string().nullable().openapi({
      description: "Email, lower-cased: typed by the merchant, or taken from the first order that brought one",
      example: "amina@example.com",
    }),
    wilayaId: z.number().int().min(1).max(LAST_WILAYA_ID).nullable().openapi({
      description: `Official wilaya number (1–${LAST_WILAYA_ID})`,
      example: 16,
    }),
    communeId: z.string().nullable().openapi({
      description: "Commune UUID from reference table",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    wilaya: z.string().openapi({
      description: "Wilaya Arabic name — denormalized display value, derived from wilayaId",
      example: "الجزائر",
    }),
    commune: z.string().nullable().openapi({
      description: "Commune Arabic name — denormalized display value, derived from communeId",
      example: "بئر مراد رايس",
    }),
    address: z.string().nullable(),
    totalOrders: z.number().int().openapi({ example: 5, description: "Every order the customer placed that still exists, in any status — read from the orders" }),
    totalSpent: z.number().openapi({ example: 25000, description: "The goods of their delivered orders, net of units refused at the door, in DZD — read from the orders" }),
    createdAt: z.string().datetime(),
    lastOrderAt: z.string().datetime().nullable().openapi({ description: "When they placed their newest order; null before any" }),
    recentOrders: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .openapi({
        description:
          "Up to 10 most recent full order records (same shape as the Orders API), newest first. Included only in GET /api/customers/{id}; not present in list responses.",
      }),
  })
  .openapi("Customer", {
    description: "Customer profile with denormalized purchase statistics",
  });

export const CustomerOrderSummarySchema = z
  .object({
    id: z.string(),
    orderNumber: z.string().openapi({ example: "ORD-20260327-0042" }),
    status: z.string().openapi({ example: "new" }),
    price: z.number().openapi({ example: 9000 }),
    createdAt: z.string().datetime(),
    wilayaId: z.number().int().nullable(),
    communeId: z.string().nullable(),
    wilaya: z.string().nullable().openapi({
      description: "Wilaya Arabic name, joined from reference table",
      example: "الجزائر",
    }),
    commune: z.string().nullable().openapi({
      description: "Commune Arabic name, joined from reference table",
      example: "بئر مراد رايس",
    }),
    stage: z.enum(ORDER_STAGES).openapi({ description: "Where the order stands overall — delivered, returned… (the same stage as GET /api/orders)" }),
  })
  .openapi("CustomerOrderSummary", {
    description: "Order summary returned by GET /api/customers/{id}/orders",
  });

export const CustomerGroupMembershipSchema = z
  .object({
    id: z.string().openapi({ example: "grp_123" }),
    name: z.string().openapi({ example: "Wholesale Customers" }),
    color: z.string().openapi({ example: "#6366f1" }),
    description: z.string().nullable(),
    memberCount: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    assignedAt: z.string().datetime().openapi({
      description: "When the customer was added to this group",
    }),
  })
  .openapi("CustomerGroupMembership");

export const CustomerTagMembershipSchema = z
  .object({
    id: z.string().openapi({ example: "tag_123" }),
    name: z.string().openapi({ example: "VIP" }),
    color: z.string().openapi({ example: "#64748b" }),
    assignmentCount: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    assignedAt: z.string().datetime().openapi({
      description: "When the tag was assigned to this customer",
    }),
  })
  .openapi("CustomerTagMembership");

export const CustomerGroupSchema = z
  .object({
    id: z.string().openapi({ example: "grp_123" }),
    name: z.string().openapi({ example: "Wholesale Customers" }),
    description: z.string().nullable().openapi({ example: "High volume buyers" }),
    color: z.string().openapi({ example: "#6366f1" }),
    memberCount: z.number().int().openapi({
      example: 12,
      description: "Denormalized count, kept in sync on add/remove member",
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    members: z
      .array(CustomerGroupMemberSchema)
      .optional()
      .openapi({
        description:
          "Included only when `?members=true` is passed to GET /api/customer-groups/{id}.",
      }),
  })
  .openapi("CustomerGroup", {
    description: "Group for segmenting customers",
  });

export const CustomerTagCustomerSchema = z
  .object({
    id: z.string().openapi({ example: "cust_123" }),
    name: z.string().openapi({ example: "Ahmed Benali" }),
    phone: z.string().openapi({ example: "0555123456" }),
    wilaya: z.string().nullable().openapi({ example: "Alger" }),
    totalOrders: z.number().int().openapi({ example: 5 }),
    totalSpent: z.number().openapi({ example: 15000 }),
    assignedAt: z.string().datetime().openapi({ example: "2024-01-15T10:30:00.000Z" }),
  })
  .openapi("CustomerTagCustomer");

export const CustomerTagSchema = z
  .object({
    id: z.string().openapi({ example: "tag_123" }),
    name: z.string().openapi({ example: "VIP" }),
    color: z.string().openapi({ example: "#64748b" }),
    assignmentCount: z.number().int().openapi({
      example: 8,
      description: "Denormalized count, kept in sync on assign/unassign",
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    customers: z
      .array(CustomerTagCustomerSchema)
      .optional()
      .openapi({
        description:
          "Included only when `?customers=true` is passed to GET /api/customer-tags/{id}.",
      }),
  })
  .openapi("CustomerTag", {
    description: "Label for tagging customers",
  });

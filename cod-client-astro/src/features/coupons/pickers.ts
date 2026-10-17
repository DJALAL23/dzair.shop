import type { PickerOption } from "@/components/ui";
import { listCollections } from "@/features/collections/api";
import { listCustomerGroups, listCustomers } from "@/features/customers/api";
import { listProducts } from "@/features/products/api";

/** What a coupon's pickers search: products and customers on the server, collections and groups in their (short) lists. */
export const couponPickers = {
  async products(query: string): Promise<PickerOption[]> {
    const { data } = await listProducts({ search: query || undefined, limit: 20 });
    return data.map((product) => ({ id: product.id, label: product.name, detail: product.sku ?? undefined }));
  },
  async collections(query: string): Promise<PickerOption[]> {
    const wanted = query.trim().toLocaleLowerCase();
    return (await listCollections())
      .filter((collection) => !wanted || collection.title.toLocaleLowerCase().includes(wanted) || collection.handle.includes(wanted))
      .map((collection) => ({ id: collection.id, label: collection.title }));
  },
  async customers(query: string): Promise<PickerOption[]> {
    const { data } = await listCustomers({ search: query || undefined, limit: 20 });
    return data.map((customer) => ({ id: customer.id, label: customer.name, detail: customer.phone }));
  },
  async groups(query: string): Promise<PickerOption[]> {
    const wanted = query.trim().toLocaleLowerCase();
    return (await listCustomerGroups())
      .filter((group) => !wanted || group.name.toLocaleLowerCase().includes(wanted))
      .map((group) => ({ id: group.id, label: group.name }));
  },
};

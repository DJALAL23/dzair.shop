import { useEffect, useRef, useState } from "react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import {
  createOrder,
  quoteDelivery,
  type DeliveryQuote,
  listCustomers,
  listProducts,
} from "@/features/orders/api";
import { listWilayas, listCommunes } from "@/features/geography/api";
import type {
  Commune,
  Customer,
  Product,
  Wilaya,
} from "@/features/orders/types";
import { Alert, FormPage } from "@/components/ui";
import { NewOrderCustomerCard } from "@/features/orders/components/NewOrderCustomerCard";
import { NewOrderDeliveryCard } from "@/features/orders/components/NewOrderDeliveryCard";
import {
  NewOrderProductsCard,
  type LineItem,
} from "@/features/orders/components/NewOrderProductsCard";
import { NewOrderSummaryCard } from "@/features/orders/components/NewOrderSummaryCard";

export function NewOrderForm() {
  const t = useT("orders");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [wilayaId, setWilayaId] = useState("");
  const [communeId, setCommuneId] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryType, setDeliveryType] = useState<"home" | "stop_desk">("home");
  const [deliveryFee, setDeliveryFee] = useState(0);
  /** The store's fee for these lines there; null until there is something to quote. */
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  /** The merchant typed a fee: the order charges it as typed. */
  const [feeTyped, setFeeTyped] = useState(false);
  const quoteRequest = useRef(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pendingCommuneId = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      listCustomers(),
      listProducts(),
      listWilayas(),
    ])
      .then(([customerRows, productRows, wilayaRows]) => {
        if (!alive) return;
        setCustomers(
          customerRows.status === "fulfilled" ? customerRows.value : [],
        );
        setProducts(
          productRows.status === "fulfilled" ? productRows.value : [],
        );
        setWilayas(wilayaRows.status === "fulfilled" ? wilayaRows.value : []);
        const failure = [customerRows, productRows, wilayaRows].find(
          (result) => result.status === "rejected",
        );
        if (failure?.status === "rejected") {
          setMessage(
            failure.reason instanceof Error
              ? failure.reason.message
              : String(failure.reason),
          );
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!customerSearch.trim()) return;
    const timer = window.setTimeout(() => {
      void listCustomers(customerSearch.trim())
        .then(setCustomers)
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [customerSearch]);

  useEffect(() => {
    if (!wilayaId) {
      setCommunes([]);
      setCommuneId("");
      return;
    }
    setCommuneId("");
    void listCommunes(Number(wilayaId))
      .then((rows) => {
        setCommunes(rows);
        if (
          pendingCommuneId.current &&
          rows.some((commune) => commune.id === pendingCommuneId.current)
        ) {
          setCommuneId(pendingCommuneId.current);
        }
        pendingCommuneId.current = null;
      })
      .catch(() => setCommunes([]));
  }, [wilayaId]);

  const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);

  // The store's fee for these lines there, decided on the server as its
  // checkout decides it; a fee the merchant typed is never overwritten.
  useEffect(() => {
    const ticket = ++quoteRequest.current;
    if (!wilayaId || lines.length === 0) {
      setQuote(null);
      return;
    }
    const timer = window.setTimeout(() => {
      quoteDelivery({
        lines: lines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? null, quantity: line.quantity })),
        subtotal,
        wilayaId: Number(wilayaId),
        communeId: communeId || null,
        deliveryType,
      })
        .then((next) => {
          if (ticket !== quoteRequest.current) return;
          setQuote(next);
          if (!feeTyped) setDeliveryFee(next.available ? next.fee : 0);
        })
        .catch(() => ticket === quoteRequest.current && setQuote(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [lines, wilayaId, communeId, deliveryType]);

  function typeFee(fee: number) {
    setFeeTyped(true);
    setDeliveryFee(fee);
  }

  function restoreStoreFee() {
    setFeeTyped(false);
    setDeliveryFee(quote?.available ? quote.fee : 0);
  }

  const selectedProduct = products.find((product) => product.id === productId);
  const variants =
    selectedProduct?.variants.filter((variant) => variant.active) ?? [];
  const selectedVariant = variants.find((variant) => variant.id === variantId);
  const total = subtotal + deliveryFee;

  function selectCustomer(customer: Customer) {
    setCustomerId(customer.id);
    setCustomerName(customer.name);
    setPhone(customer.phone);
    setAddress(customer.address ?? "");
    setCommuneId(customer.communeId ?? "");
    pendingCommuneId.current = customer.communeId ?? null;
    setWilayaId(customer.wilayaId ? String(customer.wilayaId) : "");
    setCustomerSearch(customer.name);
    if (
      customer.wilayaId &&
      String(customer.wilayaId) === wilayaId &&
      customer.communeId
    ) {
      void listCommunes(customer.wilayaId)
        .then((rows) => {
          setCommunes(rows);
          if (rows.some((commune) => commune.id === customer.communeId)) {
            setCommuneId(customer.communeId ?? "");
          }
        })
        .catch(() => setCommunes([]));
    }
  }

  function clearCustomer() {
    setCustomerId("");
    setCustomerSearch("");
    setCustomerName("");
    setPhone("");
    setCustomerEmail("");
    setWilayaId("");
    setCommuneId("");
    setCommunes([]);
    setAddress("");
    pendingCommuneId.current = null;
  }

  function addLine() {
    if (!selectedProduct || (variants.length > 0 && !selectedVariant)) return;
    const item: LineItem = {
      id: crypto.randomUUID(),
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      variantId: selectedVariant?.id,
      variantLabel: selectedVariant
        ? Object.values(selectedVariant.variations).join(" / ")
        : undefined,
      quantity: Math.max(1, quantity),
      pricePerUnit: selectedVariant?.price ?? selectedProduct.price,
      lineTotal:
        Math.max(1, quantity) *
        (selectedVariant?.price ?? selectedProduct.price),
    };
    setLines((current) => [...current, item]);
    setProductId("");
    setVariantId("");
    setQuantity(1);
  }

  async function save() {
    const nextErrors: Record<string, string> = {};
    if (!customerName.trim())
      nextErrors.customerName = t("form.error_customer_name");
    if (!/^0[5-7]\d{8}$/.test(phone.trim()))
      nextErrors.phone = t("form.error_invalid_phone");
    if (!wilayaId) nextErrors.wilayaId = t("form.error_wilaya");
    if (!communeId) nextErrors.communeId = t("form.error_commune");
    if (deliveryType === "home" && !address.trim())
      nextErrors.address = t("form.error_address");
    if (lines.length === 0) nextErrors.products = t("form.error_no_products");
    if (quote && !quote.available && !feeTyped)
      nextErrors.deliveryFee = t("form.error_delivery_unserved");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setBusy(true);
    setMessage(null);
    try {
      await createOrder({
        customerId: customerId || crypto.randomUUID(),
        customerName: customerName.trim(),
        phone: phone.trim(),
        // Empty box means "no email", never an empty string in the column.
        customerEmail: customerEmail.trim() || undefined,
        wilayaId: Number(wilayaId),
        communeId,
        address: address.trim() || undefined,
        price: subtotal,
        notes: notes.trim() || undefined,
        // Entered by the merchant: an offline order. Without a typed fee the
        // server charges the store's, as quoted, and records its offer.
        orderType: "offline",
        deliveryType,
        ...(feeTyped ? { deliveryFee } : {}),
        products: lines.map(({ id: _id, ...line }) => line),
      });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
      notify.error(common("feedback.action_failed"));
      setBusy(false);
      return;
    }
    notify.flashSuccess(t("form.success_add"));
    window.location.assign("/orders");
  }

  if (!canScope(identity, "orders:create")) {
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  }

  if (loading)
    return (
      <div role="status" aria-busy="true" className="space-y-3">
        <div className="h-24 shimmer rounded-xl" />
        <div className="h-72 shimmer rounded-xl" />
      </div>
    );

  return (
    <FormPage
      title={t("form.title_add")}
      backHref="/orders"
      error={message}
      onSave={() => void save()}
      saving={busy}
      saveLabel={t("form.form_save_create")}
      aside={
        <div className="space-y-4 lg:sticky lg:top-5">
          <NewOrderSummaryCard subtotal={subtotal} deliveryFee={deliveryFee} total={total} locale={locale} />
        </div>
      }
    >
          <NewOrderProductsCard
            products={products}
            lines={lines}
            setLines={setLines}
            productId={productId}
            setProductId={setProductId}
            variantId={variantId}
            setVariantId={setVariantId}
            quantity={quantity}
            setQuantity={setQuantity}
            errors={errors}
            locale={locale}
            onAddLine={addLine}
          />
          <NewOrderCustomerCard
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            customerId={customerId}
            setCustomerId={setCustomerId}
            customerName={customerName}
            setCustomerName={setCustomerName}
            phone={phone}
            setPhone={setPhone}
            customerEmail={customerEmail}
            setCustomerEmail={setCustomerEmail}
            wilayaId={wilayaId}
            setWilayaId={setWilayaId}
            communeId={communeId}
            setCommuneId={setCommuneId}
            address={address}
            setAddress={setAddress}
            customers={customers}
            wilayas={wilayas}
            communes={communes}
            errors={errors}
            locale={locale}
            onSelectCustomer={selectCustomer}
            onClearCustomer={clearCustomer}
            pendingCommuneIdRef={pendingCommuneId}
          />
          <NewOrderDeliveryCard
            deliveryType={deliveryType}
            setDeliveryType={setDeliveryType}
            deliveryFee={deliveryFee}
            onFeeTyped={typeFee}
            onUseStoreFee={restoreStoreFee}
            feeTyped={feeTyped}
            quote={quote}
            notes={notes}
            setNotes={setNotes}
            errors={errors}
          />
    </FormPage>
  );
}

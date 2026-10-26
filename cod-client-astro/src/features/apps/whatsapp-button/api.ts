import { appRequest } from "../api";
import type { WhatsAppWidgetResponse } from "./types";

export const getWhatsAppButtonApp = () => appRequest<WhatsAppWidgetResponse>("whatsapp-button", "", "GET");

export const saveWhatsAppButtonApp = (payload: Record<string, unknown>) => appRequest<WhatsAppWidgetResponse>("whatsapp-button", "", "PUT", payload);

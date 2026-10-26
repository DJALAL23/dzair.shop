import { appRequest } from "../api";
import type { TelegramApp, TelegramChange, TelegramPairing, TelegramTest } from "./types";

export const getTelegramApp = () => appRequest<TelegramApp | null>("telegram", "", "GET");

/** Telegram checks the token and the bot's updates are pointed at the store before anything is kept. */
export const saveTelegramBot = (token: string) => appRequest<TelegramApp>("telegram", "/bot", "PUT", { token });

/** A one-time link that connects the chat whose owner presses Start on it. */
export const openTelegramPairing = () => appRequest<TelegramPairing>("telegram", "/pairing", "POST");

export const sendTelegramTest = () => appRequest<TelegramTest>("telegram", "/test", "POST");

export const changeTelegramApp = (change: TelegramChange) => appRequest<TelegramApp>("telegram", "", "PATCH", change);

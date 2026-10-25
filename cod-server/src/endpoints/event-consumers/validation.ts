import { z } from "@hono/zod-openapi";
import { REPLAY_MAX_EVENTS } from "../../../../cod-shared/events/deliveries";

export const consumerChangeSchema = z.object({
  enabled: z.boolean().openapi({ description: "Start (true) or stop (false) delivering to it" }),
});

const sequence = z.number().int().min(1);
export const replaySchema = z
  .object({
    fromSequence: sequence.openapi({ description: "The first Business Event to deliver again, by Sequence" }),
    toSequence: sequence.openapi({ description: `The last one; at most ${REPLAY_MAX_EVENTS} Sequences after the first` }),
  })
  .refine((range) => range.fromSequence <= range.toSequence && range.toSequence - range.fromSequence < REPLAY_MAX_EVENTS, {
    message: `A Replay spans 1 to ${REPLAY_MAX_EVENTS} Sequences, from the first to the last`,
    path: ["toSequence"],
  });

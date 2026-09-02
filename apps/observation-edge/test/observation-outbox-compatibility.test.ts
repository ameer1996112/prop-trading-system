import { describe, expect, it, vi } from "vitest";

import { ObservationOutboxDispatcher } from "../src/index";
import type { Env } from "../src/types";

describe("ObservationOutboxDispatcher compatibility shell", () => {
  it("remains inert while preserving the historical Durable Object class name", async () => {
    const deleteAlarm = vi.fn(async () => undefined);
    const dispatcher = new ObservationOutboxDispatcher(
      { storage: { deleteAlarm } } as unknown as DurableObjectState,
      {} as Env,
    );

    await expect(dispatcher.wake()).resolves.toEqual({ status: "DISABLED" });
    const response = await dispatcher.fetch(new Request("https://edge.example/"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OUTBOX_DISABLED",
        message: "Observation outbox dispatch is disabled",
      },
    });

    await dispatcher.alarm();
    expect(deleteAlarm).toHaveBeenCalledTimes(1);
  });
});

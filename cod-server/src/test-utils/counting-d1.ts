/** The D1 binding, counting each trip to the database: a statement run on its own, or a whole batch. */
export function countingD1(raw: D1Database) {
  let trips = 0;
  const targets = new WeakMap<object, D1PreparedStatement>();
  const statement = (target: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(target, {
      get(t, prop) {
        const value = Reflect.get(t, prop, t);
        if (prop === "bind") return (...args: unknown[]) => statement(value.apply(t, args));
        if (prop === "all" || prop === "run" || prop === "first" || prop === "raw") return (...args: unknown[]) => (trips++, value.apply(t, args));
        return typeof value === "function" ? value.bind(t) : value;
      },
    });
    targets.set(proxy, target);
    return proxy;
  };
  const counted = new Proxy(raw, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (prop === "prepare") return (sql: string) => statement(value.call(t, sql));
      if (prop === "batch") return (statements: D1PreparedStatement[]) => (trips++, value.call(t, statements.map((s) => targets.get(s) ?? s)));
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
  return { raw: counted, trips: () => trips };
}

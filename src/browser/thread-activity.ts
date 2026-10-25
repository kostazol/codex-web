type Lease = { [Symbol.dispose](): void };
type ListState = {
  summary: {
    conversationId: string;
    threadRuntimeStatus?: { type: string };
  };
  isConversationInProgress?: boolean;
};
type Subscription = {
  type: string;
  field?: string;
  key: { threadId?: string };
  listener: (value: ListState | ListState[] | null) => void;
};
type Manager = {
  isCloudHost: boolean;
  subscribe(subscription: Subscription): () => void;
  retainActiveConversation(id: string): Lease;
};

export function getThreadAttentionState(
  state: ListState | null,
  unread: boolean,
  pending: unknown,
) {
  if (pending != null) return "waiting";
  if (unread) return "unread";
  return state?.summary.threadRuntimeStatus?.type === "active" ||
    state?.isConversationInProgress
    ? "active"
    : "idle";
}

// A list subscription normally reads only this client's store. In a browser,
// the owner of a running chat can be another Desktop window/process. Retaining
// interest uses Desktop's existing follower snapshot + revisioned patch stream;
// it neither resumes a thread nor marks it read. Do not infer activity from age.
// The bundle adapter must use Desktop's RpcSubscription.subscribe BEFORE this
// wrapper. It owns the duplicated remote callback; a plain closure here cannot
// replace that ownership and would stop receiving updates after the RPC returns.
export function subscribeThreadActivity(
  manager: Manager,
  subscription: Subscription,
) {
  const recent =
    subscription.type === "host" && subscription.field === "recentThreads";
  const row =
    subscription.type === "thread" && subscription.field === "listState";
  if (manager.isCloudHost || (!recent && !row))
    return manager.subscribe(subscription);

  const leases = new Map<string, Lease | null>();
  let closed = false;
  let revision = 0;
  const reconcile = (ids: string[]) => {
    if (closed) return;
    const current = ++revision;
    const wanted = new Set(ids);
    for (const [id, lease] of leases) {
      if (!wanted.has(id)) {
        leases.delete(id);
        lease?.[Symbol.dispose]();
      }
    }
    for (const id of wanted) {
      if (closed || current !== revision) return;
      if (leases.has(id)) continue;
      // Reserve before retaining: Desktop callbacks may synchronously publish.
      leases.set(id, null);
      const lease = manager.retainActiveConversation(id);
      if (closed || !leases.has(id)) lease[Symbol.dispose]();
      else leases.set(id, lease);
    }
  };
  const release = () => {
    closed = true;
    revision++;
    for (const lease of leases.values()) lease?.[Symbol.dispose]();
    leases.clear();
  };
  let unsubscribe: () => void;
  try {
    unsubscribe = manager.subscribe({
      ...subscription,
      listener(value) {
        if (closed) return;
        // Publish metadata first. A follower snapshot must never be overwritten
        // by the older initial list callback after retainActiveConversation.
        subscription.listener(value);
        reconcile(
          recent
            ? (value as ListState[]).map((item) => item.summary.conversationId)
            : subscription.key.threadId
              ? [subscription.key.threadId]
              : [],
        );
      },
    });
  } catch (error) {
    release();
    throw error;
  }
  return () => {
    if (closed) return;
    try {
      unsubscribe();
    } finally {
      release();
    }
  };
}

export type NetworkRequest =
  | {
      type: "fetch";
      id: string;
      url: string;
      method: string;
      headers: [string, string][];
      body?: string;
      redirect: RequestRedirect;
      credentials: RequestCredentials;
    }
  | { type: "cancel" | "pull"; id: string };

export type NetworkResponse =
  | { type: "ready"; chrome: string; electron: string }
  | {
      type: "headers";
      id: string;
      status: number;
      statusText: string;
      headers: [string, string][];
      url: string;
    }
  | { type: "chunk"; id: string; data: string }
  | { type: "end"; id: string }
  | { type: "error"; id: string; message: string };

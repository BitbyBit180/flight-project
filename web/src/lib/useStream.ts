import { useEffect, useRef, useState } from "react";
import { Connection, type StreamState } from "./connection.js";

/**
 * Open a single WS connection for the lifetime of the page and expose its
 * live state plus the connection handle (for sending patches).
 */
export function useStream(role: "display" | "control"): {
  state: StreamState;
  conn: Connection;
} {
  const connRef = useRef<Connection | null>(null);
  if (!connRef.current) connRef.current = new Connection(role);
  const conn = connRef.current;

  const [state, setState] = useState<StreamState>(conn.state);

  useEffect(() => {
    const unsub = conn.subscribe(setState);
    conn.connect();
    return () => {
      unsub();
      conn.close();
    };
  }, [conn]);

  return { state, conn };
}

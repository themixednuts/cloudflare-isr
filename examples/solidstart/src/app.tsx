import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";

export default function App() {
  return (
    <Router
      root={(props) => (
        <>
          <nav>
            <a href="/">Home</a>{" | "}
            <a href="/blog/hello-world">Hello World</a>{" | "}
            <a href="/blog/getting-started">Getting Started</a>
          </nav>
          <hr />
          <Suspense>{props.children}</Suspense>
        </>
      )}
    >
      <FileRoutes />
    </Router>
  );
}

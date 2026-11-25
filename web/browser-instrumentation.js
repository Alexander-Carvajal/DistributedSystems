import { startBrowserSdk } from "@opentelemetry/browser-sdk";
import { DocumentLoadInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/document-load";
import { FetchInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/fetch";

startBrowserSdk({
  serviceName: "store-web",
  resourceAttributes: {
    "service.namespace": "store-web",
    "deployment.environment.name": "dev",
  },
  traces: {
    exportConfig: { url: `${window.location.origin}/v1/traces` },
  },
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new FetchInstrumentation({ ignoreUrls: [/\/v1\/traces(?:$|\?)/] }),
  ],
});

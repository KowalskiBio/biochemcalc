import { TooltipProvider } from "@radix-ui/react-tooltip"
import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import { App } from "./App"
import "./styles/globals.css"

const rootElement = document.getElementById("root")

if (rootElement === null) {
  throw new Error("Root element not found")
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <App />
      </TooltipProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

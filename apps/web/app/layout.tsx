import type { ReactNode } from "react";
import "./globals.css";
import { RootClientWrapper } from "./RootClientWrapper";

export const metadata = { title: "ANDY — The cat that codes for you." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it" translate="no" suppressHydrationWarning>
      <body>
        <RootClientWrapper>
          {children}
        </RootClientWrapper>
      </body>
    </html>
  );
}

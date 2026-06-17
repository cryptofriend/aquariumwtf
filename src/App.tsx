import { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { FC, PropsWithChildren } from "react";
import {
  ConnectionProvider as SolanaConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider as SolanaWalletModalProvider } from "@solana/wallet-adapter-react-ui";

// wallet-adapter ships React 19-style types; this app is on React 18.
// Re-type the providers so JSX accepts them — runtime is unaffected.
const ConnectionProvider = SolanaConnectionProvider as unknown as FC<PropsWithChildren<{ endpoint: string }>>;
const WalletProvider = SolanaWalletProvider as unknown as FC<PropsWithChildren<{ wallets: unknown[]; autoConnect?: boolean }>>;
const WalletModalProvider = SolanaWalletModalProvider as unknown as FC<PropsWithChildren>;
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { SOLANA_RPC } from "./solana/fish";
import "@solana/wallet-adapter-react-ui/styles.css";


const queryClient = new QueryClient();

const App = () => {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={SOLANA_RPC}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <Routes>
                <Route path="/" element={<Index />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
};

export default App;

"use client";

// @refresh reset
import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Balance } from "@scaffold-ui/components";
import { getBlockExplorerAddressLink } from "@scaffold-ui/hooks";
import { Address, getAddress } from "viem";
import { mainnet } from "viem/chains";
import { useAccount, useEnsAvatar, useEnsName } from "wagmi";
import {
  ArrowLeftOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  DocumentDuplicateIcon,
} from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { NetworkOptions } from "~~/components/scaffold-eth/RainbowKitCustomConnectButton/NetworkOptions";
import { useCopyToClipboard, useNetworkColor, useOutsideClick } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getTargetNetworks } from "~~/utils/scaffold-eth";

const allowedNetworks = getTargetNetworks();

/**
 * Privy-aware address dropdown. Mirrors RainbowKit's AddressInfoDropdown but logs
 * the user out through Privy (`logout`) instead of wagmi's `useDisconnect`, since
 * the embedded/smart wallet session is owned by Privy.
 */
const PrivyAddressDropdown = ({
  address,
  displayName,
  ensAvatar,
  blockExplorerAddressLink,
  onLogout,
}: {
  address: Address;
  displayName: string;
  ensAvatar?: string;
  blockExplorerAddressLink?: string;
  onLogout: () => void;
}) => {
  const checkSumAddress = getAddress(address);
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();
  const [selectingNetwork, setSelectingNetwork] = useState(false);
  const dropdownRef = useRef<HTMLDetailsElement>(null);

  const closeDropdown = () => {
    setSelectingNetwork(false);
    dropdownRef.current?.removeAttribute("open");
  };
  useOutsideClick(dropdownRef, closeDropdown);

  return (
    <details ref={dropdownRef} className="dropdown dropdown-end leading-3">
      <summary className="btn btn-secondary btn-sm pl-0 pr-2 shadow-md dropdown-toggle gap-0 h-auto!">
        <BlockieAvatar address={checkSumAddress} size={30} ensImage={ensAvatar} />
        <span className="ml-2 mr-1">
          {displayName || checkSumAddress.slice(0, 6) + "..." + checkSumAddress.slice(-4)}
        </span>
        <ChevronDownIcon className="h-6 w-4 ml-2 sm:ml-0" />
      </summary>
      <ul className="dropdown-content menu z-2 p-2 mt-2 shadow-center shadow-accent bg-base-200 rounded-box gap-1">
        <NetworkOptions hidden={!selectingNetwork} />
        <li className={selectingNetwork ? "hidden" : ""}>
          <div
            className="h-8 btn-sm rounded-xl! flex gap-3 py-3 cursor-pointer"
            onClick={() => copyToClipboard(checkSumAddress)}
          >
            {isCopiedToClipboard ? (
              <>
                <CheckCircleIcon className="text-xl font-normal h-6 w-4 ml-2 sm:ml-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Copied!</span>
              </>
            ) : (
              <>
                <DocumentDuplicateIcon className="text-xl font-normal h-6 w-4 ml-2 sm:ml-0" aria-hidden="true" />
                <span className="whitespace-nowrap">Copy address</span>
              </>
            )}
          </div>
        </li>
        <li className={selectingNetwork ? "hidden" : ""}>
          <button className="h-8 btn-sm rounded-xl! flex gap-3 py-3" type="button">
            <ArrowTopRightOnSquareIcon className="h-6 w-4 ml-2 sm:ml-0" />
            <a target="_blank" href={blockExplorerAddressLink} rel="noopener noreferrer" className="whitespace-nowrap">
              View on Block Explorer
            </a>
          </button>
        </li>
        {allowedNetworks.length > 1 ? (
          <li className={selectingNetwork ? "hidden" : ""}>
            <button
              className="h-8 btn-sm rounded-xl! flex gap-3 py-3"
              type="button"
              onClick={() => setSelectingNetwork(true)}
            >
              <ArrowsRightLeftIcon className="h-6 w-4 ml-2 sm:ml-0" /> <span>Switch Network</span>
            </button>
          </li>
        ) : null}
        <li className={selectingNetwork ? "hidden" : ""}>
          <button
            className="menu-item text-error h-8 btn-sm rounded-xl! flex gap-3 py-3"
            type="button"
            onClick={onLogout}
          >
            <ArrowLeftOnRectangleIcon className="h-6 w-4 ml-2 sm:ml-0" /> <span>Disconnect</span>
          </button>
        </li>
      </ul>
    </details>
  );
};

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/**
 * Privy connect button (drop-in replacement for RainbowKitCustomConnectButton).
 *
 * Outer component: ensures Privy hooks are only ever called inside the
 * `PrivyProvider` stack. During SSR/prerender and when no Privy App ID is set, the
 * provider stack is not mounted (see ScaffoldEthAppWithProviders), so we render a
 * static button without touching `usePrivy`.
 */
export const PrivyConnectButton = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !PRIVY_APP_ID) {
    return (
      <button className="btn btn-primary btn-sm" type="button" disabled={!PRIVY_APP_ID}>
        Connect Wallet
      </button>
    );
  }

  return <PrivyConnectButtonInner />;
};

/**
 * Inner component: uses Privy's `usePrivy` ({ ready, authenticated, login, logout })
 * for auth, and wagmi's `useAccount` for the active (smart) account + chain. ENS
 * name and avatar are resolved against Ethereum Mainnet (chainId 1) even when the
 * app's active chain is an L2, and fall back to a truncated address.
 *
 * Confirmed in Privy docs:
 * - usePrivy: https://docs.privy.io/wallets/connectors/ethereum/integrations/wagmi
 */
const PrivyConnectButtonInner = () => {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address, chain } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const networkColor = useNetworkColor();

  // ENS MUST resolve against Mainnet, not the app's active L2.
  const { data: ensName } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled: Boolean(address) },
  });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? undefined,
    chainId: mainnet.id,
    query: { enabled: Boolean(ensName) },
  });

  // Privy initializes asynchronously; always gate on `ready`.
  if (!ready) {
    return <div className="btn btn-primary btn-sm pointer-events-none animate-pulse">…</div>;
  }

  if (!authenticated || !address) {
    return (
      <button className="btn btn-primary btn-sm" onClick={login} type="button">
        Connect Wallet
      </button>
    );
  }

  if (chain && chain.id !== targetNetwork.id) {
    // Mirror RainbowKit's wrong-network UX with a Privy-aware logout.
    return (
      <div className="dropdown dropdown-end mr-2">
        <label tabIndex={0} className="btn btn-error btn-sm dropdown-toggle gap-1">
          <span>Wrong network</span>
          <ChevronDownIcon className="h-6 w-4 ml-2 sm:ml-0" />
        </label>
        <ul
          tabIndex={0}
          className="dropdown-content menu p-2 mt-1 shadow-center shadow-accent bg-base-200 rounded-box gap-1"
        >
          <NetworkOptions />
          <li>
            <button className="menu-item text-error btn-sm rounded-xl! flex gap-3 py-3" type="button" onClick={logout}>
              <ArrowLeftOnRectangleIcon className="h-6 w-4 ml-2 sm:ml-0" />
              <span>Disconnect</span>
            </button>
          </li>
        </ul>
      </div>
    );
  }

  const blockExplorerAddressLink = getBlockExplorerAddressLink(targetNetwork, address);

  return (
    <>
      <div className="flex flex-col items-center mr-2">
        <Balance
          address={address}
          style={{
            minHeight: "0",
            height: "auto",
            fontSize: "0.8em",
          }}
        />
        <span className="text-xs" style={{ color: networkColor }}>
          {chain?.name}
        </span>
      </div>
      <PrivyAddressDropdown
        address={address}
        displayName={ensName ?? ""}
        ensAvatar={ensAvatar ?? undefined}
        blockExplorerAddressLink={blockExplorerAddressLink}
        onLogout={logout}
      />
    </>
  );
};

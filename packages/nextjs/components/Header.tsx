"use client";

import React, { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hardhat } from "viem/chains";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { FaucetButton, PrivyConnectButton } from "~~/components/scaffold-eth";
import { useOutsideClick, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { FLOW } from "~~/kredito/flow";

type HeaderMenuLink = {
  label: string;
  href: string;
};

export const menuLinks: HeaderMenuLink[] = [
  { label: "Overview", href: "/" },
  ...FLOW.map(s => ({ label: s.label, href: s.href })),
];

export const HeaderMenuLinks = () => {
  const pathname = usePathname();

  return (
    <>
      {menuLinks.map(({ label, href }) => {
        const isActive = pathname === href;
        return (
          <li key={href}>
            <Link
              href={href}
              passHref
              className={`${
                isActive ? "bg-primary text-primary-content shadow-sm" : "hover:bg-base-200"
              } py-1.5 px-3 text-sm rounded-full gap-2 grid grid-flow-col transition-colors`}
            >
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

const BrandMark = () => (
  <Link href="/" passHref className="flex items-center ml-3 mr-5 shrink-0" aria-label="Kredito">
    {/* dark-on-light lockup for the light theme, white lockup for the dark theme */}
    <Image
      src="/kredito-lockup.svg"
      alt="Kredito"
      width={144}
      height={44}
      priority
      unoptimized
      className="h-11 w-auto block dark:hidden"
    />
    <Image
      src="/kredito-lockup-white.svg"
      alt="Kredito"
      width={144}
      height={44}
      priority
      unoptimized
      className="h-11 w-auto hidden dark:block"
    />
  </Link>
);

/**
 * Site header
 */
export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100 min-h-0 shrink-0 justify-between z-20 border-b border-base-300 px-0 sm:px-2">
      <div className="navbar-start w-auto lg:w-2/3">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost lg:hidden hover:bg-transparent">
            <Bars3Icon className="h-1/2" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content mt-3 p-2 shadow-sm bg-base-100 rounded-box w-52 border border-base-300"
            onClick={() => {
              burgerMenuRef?.current?.removeAttribute("open");
            }}
          >
            <HeaderMenuLinks />
          </ul>
        </details>
        <BrandMark />
        <ul className="hidden lg:flex lg:flex-nowrap menu menu-horizontal px-1 gap-1">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end grow mr-4 gap-2">
        <PrivyConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>
    </div>
  );
};

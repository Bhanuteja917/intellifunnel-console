"use client";

import Link from "next/link";
import type { Route } from "next";
import { Fragment } from "react";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  campaigns: "Campaigns",
  assets: "Assets",
  "consent-texts": "Consent texts",
  "channel-types": "Channel types",
  organizations: "Organisations",
  "resolution-queue": "Resolution queue",
  verification: "Verification",
};

const NEW_LABELS: Readonly<Record<string, string>> = {
  campaigns: "New Campaign",
  assets: "New Asset",
  "consent-texts": "New Consent Text",
};

function labelFor(segment: string, parentSegment: string | undefined): string {
  // hasOwn, not a bare lookup: a segment named after an Object.prototype key
  // ("constructor", "toString") matches /campaigns/[id] and would otherwise
  // resolve to an inherited function that React then tries to render.
  if (segment === "new" && parentSegment && Object.hasOwn(NEW_LABELS, parentSegment)) {
    return NEW_LABELS[parentSegment]!;
  }
  if (Object.hasOwn(SEGMENT_LABELS, segment)) return SEGMENT_LABELS[segment]!;
  if (segment === "new") return "New";
  if (!segment.includes(" ") && !segment.includes("-") && segment.length > 10) return "Details";
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

export function HeaderBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          const crumbHref = `/${segments.slice(0, index + 1).join("/")}` as Route;
          return (
            <Fragment key={crumbHref}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{labelFor(segment, segments[index - 1])}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumbHref}>{labelFor(segment, segments[index - 1])}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

"use client";

import Link from "next/link";
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
  new: "New Campaign",
  "channel-types": "Channel types",
  organizations: "Organisations",
  "resolution-queue": "Resolution queue",
};

function labelFor(segment: string): string {
  const known = SEGMENT_LABELS[segment];
  if (known !== undefined) return known;
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
          return (
            <Fragment key={`${index}`}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{labelFor(segment)}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={`/${segments.slice(0, index + 1).join("/")}` as any}>{labelFor(segment)}</Link>
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

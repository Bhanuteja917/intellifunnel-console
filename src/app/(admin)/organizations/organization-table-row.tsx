"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

export function OrganizationTableRow({
  organizationId,
  children,
}: {
  organizationId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => router.push(`/organizations/${organizationId}`)}
    >
      {children}
    </TableRow>
  );
}

"use client";

import { use } from "react";

import ItemForm from "@/components/ItemForm";

type ItemEditPageProps = {
  params: Promise<{ id: string }>;
};

export default function ItemEditPage({ params }: ItemEditPageProps) {
  const { id } = use(params);
  return <ItemForm itemId={id} />;
}

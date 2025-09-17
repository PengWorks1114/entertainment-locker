import ItemForm from "@/components/ItemForm";

type NewItemPageProps = {
  searchParams?: {
    cabinetId?: string;
  };
};

export default function NewItemPage({ searchParams }: NewItemPageProps) {
  const cabinetIdParam = searchParams?.cabinetId;
  const cabinetId = typeof cabinetIdParam === "string" ? cabinetIdParam : undefined;
  return <ItemForm initialCabinetId={cabinetId} />;
}

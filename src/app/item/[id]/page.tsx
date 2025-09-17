import ItemForm from "@/components/ItemForm";

type ItemPageProps = {
  params: { id: string };
};

export default function ItemEditPage({ params }: ItemPageProps) {
  return <ItemForm itemId={params.id} />;
}

import DocumentsApp, { type DocumentsView } from './documents-app';

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { view } = await searchParams;
  const initialView: DocumentsView | undefined =
    view === 'home' || view === 'library' || view === 'letter' ? view : undefined;
  return <DocumentsApp initialView={initialView} syncRoute />;
}

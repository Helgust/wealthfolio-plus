// A planner page while its data loads or when loading failed.
import { Alert, AlertDescription, Page, PageContent } from '@wealthfolio/ui';

export function PageMessage({ error }: { error?: unknown }) {
  return (
    <Page>
      <PageContent>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>Could not load data: {String(error)}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">Loading…</p>
        )}
      </PageContent>
    </Page>
  );
}

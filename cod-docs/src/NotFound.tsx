import { Button, Link } from "zudoku/components";
import { ArrowLeftIcon, BracesIcon } from "zudoku/icons";

export function NotFound() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center px-6 py-20">
      <div className="text-center">
        <p className="font-mono text-7xl font-semibold tracking-tighter text-primary">404</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
          This page went off-route.
        </h1>
        <p className="mt-3 text-muted-foreground">
          The page you are looking for does not exist, or it moved while the docs were regenerated.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/">
              <ArrowLeftIcon className="me-2 size-4" />
              Back home
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/api">
              <BracesIcon className="me-2 size-4" />
              API reference
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

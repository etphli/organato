import { lazy, type ComponentType } from "react";

export function prefetchablePage<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  let LoadedPage: ComponentType<Props> | undefined;
  let pending: ReturnType<typeof load> | undefined;
  const preload = () => {
    pending ??= load().then(
      (module) => {
        LoadedPage = module.default;
        return module;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  const LazyPage = lazy(preload);
  function Page(props: Props) {
    const Component = LoadedPage ?? LazyPage;
    return <Component {...props} />;
  }
  return { Page, preload };
}

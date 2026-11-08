import { useQuery } from '@tanstack/react-query'

import { fetchPublicPricing } from './api'

/** Not organization-scoped: the price list is public and the same for everyone. */
export const marketingKeys = {
  pricing: () => ['marketing', 'pricing'] as const,
}

export function usePublicPricing() {
  return useQuery({
    queryKey: marketingKeys.pricing(),
    queryFn: fetchPublicPricing,
    staleTime: 5 * 60_000,
    // The fetch already resolves every failure to "no pricing"; retrying
    // would only delay the page deciding to render nothing.
    retry: false,
  })
}

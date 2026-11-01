import { Suspense } from 'react';
import { LoadingBlock } from 'components/ui/states';
import { MeClient } from './me-client';

export default function MePage() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingBlock /></div>}>
      <MeClient />
    </Suspense>
  );
}

import { Box, CircularProgress } from '@mui/material';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getMe, type Me } from './api.js';
import { TedmarksDataProvider } from './data/TedmarksData.js';
import { PlaceActionsProvider } from './actions/PlaceActions.js';
import { HomePage } from './home/HomePage.js';
import { PlacePage } from './place/PlacePage.js';
import { PlacesPage } from './places/PlacesPage.js';
import { SignInPage } from './SignInPage.js';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const location = useLocation();

  useEffect(() => {
    getMe().then(setMe).catch(() => setMe({ signedIn: false, appleUserId: null, configured: false }));
  }, [location.pathname]);

  if (!me) {
    return <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}><CircularProgress /></Box>;
  }
  return (
    <Routes>
      <Route path="/signin" element={me.signedIn ? <Navigate to="/" replace /> : <SignInPage />} />
      <Route path="/*" element={me.signedIn ? <SignedIn onSignedOut={() => setMe({ ...me, signedIn: false })} /> : <Navigate to="/signin" replace />} />
    </Routes>
  );
}

/** The signed-in app: everything shares the data and the place actions (and their Undo banner). */
function SignedIn({ onSignedOut }: { onSignedOut: () => void }) {
  return (
    <TedmarksDataProvider>
      <PlaceActionsProvider>
        <Routes>
          <Route path="/place/:placeId" element={<PlacePage onSignedOut={onSignedOut} />} />
          <Route path="/places" element={<PlacesPage onSignedOut={onSignedOut} />} />
          <Route path="*" element={<HomePage onSignedOut={onSignedOut} />} />
        </Routes>
      </PlaceActionsProvider>
    </TedmarksDataProvider>
  );
}

import { useEffect } from 'react';

const HashScroll = () => {
  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash;
      if (!hash) return;

      window.setTimeout(() => {
        const target = document.getElementById(decodeURIComponent(hash.slice(1)));
        target?.scrollIntoView({ block: 'start' });
      }, 0);
    };

    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  }, []);

  return null;
};

export default HashScroll;
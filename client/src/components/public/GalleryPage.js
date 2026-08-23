import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Footer, GALLERY_IMAGES, Header, WhatsAppButton } from './LandingPage';

const Arrow = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const GalleryPage = () => {
  const [category, setCategory] = useState('All');
  const [selectedIndex, setSelectedIndex] = useState(null);

  const categories = useMemo(() => ['All', ...new Set(GALLERY_IMAGES.map((image) => image.category))], []);
  const visibleImages = useMemo(
    () => category === 'All' ? GALLERY_IMAGES : GALLERY_IMAGES.filter((image) => image.category === category),
    [category],
  );
  const selectedImage = selectedIndex === null ? null : visibleImages[selectedIndex];

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Gallery | Harmony Learning Institute';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    if (selectedIndex === null) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedIndex(null);
      if (event.key === 'ArrowLeft') setSelectedIndex((current) => (current - 1 + visibleImages.length) % visibleImages.length);
      if (event.key === 'ArrowRight') setSelectedIndex((current) => (current + 1) % visibleImages.length);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedIndex, visibleImages.length]);

  const changeCategory = (nextCategory) => {
    setCategory(nextCategory);
    setSelectedIndex(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="pt-[6.5rem] md:pt-[7.4rem]">
        <section className="relative overflow-hidden bg-blue-950 py-16 sm:py-20">
          <div className="absolute inset-0 opacity-30">
            <img src={GALLERY_IMAGES[3].src} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-blue-950 via-blue-950/95 to-blue-950/60" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs font-extrabold tracking-[0.16em] uppercase text-red-300">Life at Harmony</p>
            <h1 className="mt-3 max-w-3xl text-4xl sm:text-5xl font-black tracking-tight text-white">A closer look at our school community.</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-blue-100">Explore real moments from learning, friendship, celebration and everyday life at Harmony Learning Institute.</p>
            <Link to="/#apply" className="mt-7 inline-flex items-center gap-2 min-h-12 px-5 rounded-lg bg-red-700 text-white font-extrabold hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-white">
              Start an application <Arrow />
            </Link>
          </div>
        </section>

        <section className="py-14 sm:py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-bold text-slate-500"><span className="text-red-700">{visibleImages.length}</span> photographs from Harmony</p>
                <h2 className="mt-2 text-3xl sm:text-4xl font-black tracking-tight text-blue-950">Moments worth remembering</h2>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Filter gallery by category">
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => changeCategory(item)}
                    aria-pressed={category === item}
                    className={`min-h-10 px-4 rounded-full text-sm font-extrabold transition-colors focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 ${category === item ? 'bg-red-700 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:border-red-200 hover:text-red-700'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {visibleImages.map((image, index) => (
                <button
                  key={image.src}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className="group relative overflow-hidden rounded-2xl bg-white text-left shadow-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                  aria-label={`View ${image.title}`}
                >
                  <div className="aspect-[4/3] overflow-hidden bg-slate-200">
                    <img src={image.src} alt={image.alt} loading="lazy" className="w-full h-full object-cover transition duration-500 group-hover:scale-105" />
                  </div>
                  <div className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold tracking-[0.12em] uppercase text-red-700">{image.category}</p>
                      <p className="mt-1 truncate font-extrabold text-blue-950">{image.title}</p>
                    </div>
                    <span className="shrink-0 inline-flex w-9 h-9 items-center justify-center rounded-full bg-slate-100 text-blue-950 group-hover:bg-red-50 group-hover:text-red-700">
                      <Arrow />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <WhatsAppButton />

      {selectedImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-blue-950/95 p-4 sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={selectedImage.title}
          onClick={(event) => { if (event.target === event.currentTarget) setSelectedIndex(null); }}
        >
          <div className="relative flex w-full max-w-5xl flex-col items-center">
            <button type="button" onClick={() => setSelectedIndex(null)} aria-label="Close image viewer" className="absolute -top-12 right-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white">
              ×
            </button>
            <img src={selectedImage.src} alt={selectedImage.alt} className="max-h-[72vh] w-auto max-w-full rounded-xl object-contain shadow-2xl" />
            <div className="mt-5 flex w-full items-center justify-between gap-4 text-white">
              <div>
                <p className="text-xs font-extrabold tracking-[0.14em] uppercase text-red-300">{selectedImage.category}</p>
                <p className="mt-1 text-lg font-extrabold">{selectedImage.title}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => setSelectedIndex((current) => (current - 1 + visibleImages.length) % visibleImages.length)} aria-label="Previous gallery image" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white">‹</button>
                <span className="text-sm font-bold tabular-nums">{selectedIndex + 1} / {visibleImages.length}</span>
                <button type="button" onClick={() => setSelectedIndex((current) => (current + 1) % visibleImages.length)} aria-label="Next gallery image" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white">›</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GalleryPage;
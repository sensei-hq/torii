/* Strategos · app.jsx — composes the site + Tweaks panel. */
const SApp = (function () {
  const Nav = window.Nav, Hero = window.Hero, StatBand = window.StatBand, Footer = window.Footer;
  const PlaygroundSection = window.PlaygroundSection;
  const GovernanceSection = window.GovernanceSection;
  const ObservabilitySection = window.ObservabilitySection;
  const EnterpriseSection = window.EnterpriseSection, ClosingCTA = window.ClosingCTA;
  const { useEffect: aUseEffect } = React;

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "density": "roomy",
    "annotations": true,
    "dark": false
  }/*EDITMODE-END*/;

  function App() {
    const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

    /* density → root attribute */
    aUseEffect(() => {
      document.documentElement.setAttribute('data-density', t.density === 'compact' ? 'compact' : 'roomy');
    }, [t.density]);

    /* pencil annotations on/off */
    aUseEffect(() => {
      document.body.classList.toggle('no-annot', !t.annotations);
    }, [t.annotations]);

    /* keep the panel's dark toggle in sync with theme.js, both directions */
    aUseEffect(() => {
      const ac = window.AnnotatedCanvas;
      if (ac && (ac.getTheme() === 'dark') !== !!t.dark) setTweak('dark', ac.getTheme() === 'dark');
      function onThemeChange(e) { setTweak('dark', e.detail.theme === 'dark'); }
      document.addEventListener('themechange', onThemeChange);
      return () => document.removeEventListener('themechange', onThemeChange);
      // eslint-disable-next-line
    }, []);

    function setDark(v) {
      setTweak('dark', v);
      if (window.AnnotatedCanvas) window.AnnotatedCanvas.setTheme(v ? 'dark' : 'light');
    }

    return (
      <React.Fragment>
        <Nav />
        <main>
          <Hero />
          <StatBand />
          <PlaygroundSection />
          <GovernanceSection />
          <ObservabilitySection />
          <EnterpriseSection />
          <ClosingCTA />
        </main>
        <Footer />

        <window.TweaksPanel title="Tweaks">
          <window.TweakSection label="Layout" />
          <window.TweakRadio label="Density" value={t.density} options={['roomy', 'compact']}
            onChange={(v) => setTweak('density', v)} />
          <window.TweakSection label="Style" />
          <window.TweakToggle label="Pencil annotations" value={t.annotations}
            onChange={(v) => setTweak('annotations', v)} />
          <window.TweakToggle label="Dark mode" value={t.dark} onChange={setDark} />
        </window.TweaksPanel>
      </React.Fragment>
    );
  }
  return App;
})();

ReactDOM.createRoot(document.getElementById('root')).render(<SApp />);

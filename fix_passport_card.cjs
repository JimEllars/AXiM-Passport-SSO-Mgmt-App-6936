const fs = require('fs');
let code = fs.readFileSync('src/components/PassportCard.jsx', 'utf8');

code = code.replace(
  /\{identities && identities\.length > 0 \? renderIdentities\(\) : \(/,
  `{identities === undefined || (busy && !methodSelected) ? (
      <section className="auth-options" aria-label="Loading authentication">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="animate-pulse bg-slate-800 rounded-lg h-12 w-full mb-3 shadow"></div>
        ))}
      </section>
    ) : identities && identities.length > 0 ? renderIdentities() : (`
);

fs.writeFileSync('src/components/PassportCard.jsx', code);

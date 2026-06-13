import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="bg-gray-50 text-gray-800">

      {/* NAVBAR */}
      <header className="bg-white shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center px-6 py-4">
          <h1 className="text-2xl font-bold text-green-700">
            Umova Investment 
          </h1>

          <nav className="flex gap-6 items-center text-sm font-medium">
            <a href="#about" className="hover:text-green-700">About</a>
            <a href="#services" className="hover:text-green-700">Services</a>
            <a href="#loans" className="hover:text-green-700">Loans</a>

            <Link to="/login" className="text-green-700 hover:underline">
              Login
            </Link>

            <Link
              to="/signup"
              className="bg-green-700 text-white px-4 py-2 rounded-lg hover:bg-green-800 transition"
            >
              Sign Up
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="bg-gradient-to-r from-green-700 to-green-500 text-white py-24">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-10 items-center">

          <div>
            <h1 className="text-5xl font-bold mb-6 leading-tight">
              Build Wealth.<br /> Secure Your Future.
            </h1>

            <p className="mb-8 text-lg opacity-90">
              Join Umova Investment Ltd and take control of your financial journey.
            </p>

            <div className="flex gap-4">
              <Link
                to="/signup"
                className="bg-white text-green-700 px-6 py-3 rounded-lg font-semibold hover:scale-105 transition"
              >
                Join Now
              </Link>

              <a
                href="#about"
                className="border border-white px-6 py-3 rounded-lg hover:bg-white hover:text-green-700 transition"
              >
                Learn More
              </a>
            </div>
          </div>

          {/* Right side visual */}
          <div className="hidden md:block">
            <div className="bg-white/20 h-64 rounded-xl flex items-center justify-center text-xl">
              📊 Financial Growth
            </div>
          </div>

        </div>
      </section>

      {/* SERVICES */}
      <section id="services" className="py-20 px-6">
        <h2 className="text-3xl font-bold text-center mb-12 text-green-700">
          Our Services
        </h2>

        <div className="max-w-7xl mx-auto grid md:grid-cols-3 gap-8">
          <Card title="Savings" icon="💰" />
          <Card title="Loans" icon="🏦" />
          <Card title="Growth" icon="📈" />
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="bg-white py-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-10 text-green-700">About Us</h2>

          <div className="grid md:grid-cols-3 gap-8">
            <Info title="Who We Are" text="We empower individuals financially." />
            <Info title="Mission" text="Provide accessible financial services." />
            <Info title="Vision" text="Be a trusted financial leader." />
          </div>
        </div>
      </section>

      {/* LOANS */}
      <section id="loans" className="py-20 px-6">
        <div className="max-w-4xl mx-auto bg-white shadow-lg rounded-xl p-10">
          <h2 className="text-2xl font-bold mb-6 text-green-700">
            Loan Qualification
          </h2>

          <ul className="space-y-3 text-gray-700">
            <li>✔ Loan = 3x savings</li>
            <li>✔ Minimum 2 months saving</li>
            <li>✔ Good repayment history</li>
            <li>✔ Proof of income</li>
            <li>✔ Guarantors required</li>
          </ul>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-20 bg-gray-100">
        <h2 className="text-3xl font-bold text-center mb-10">
          What Our Clients Say
        </h2>

        <div className="max-w-4xl mx-auto grid gap-6 md:grid-cols-2">
          <Testimonial text="Umova helped me save and get my first loan easily!" name="Jane D." />
          <Testimonial text="Professional, transparent, and reliable." name="John M." />
        </div>
      </section>

      {/* CTA */}
      <section className="bg-green-700 text-white text-center py-20">
        <h2 className="text-3xl font-bold mb-6">
          Start Your Financial Journey Today
        </h2>

        <Link
          to="/signup"
          className="bg-white text-green-700 px-6 py-3 rounded-lg font-semibold hover:scale-105 transition"
        >
          Join Now
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-800 text-white text-center p-6">
        <p>© 2026 Umova Investment Ltd. All rights reserved.</p>
      </footer>

    </div>
  );
}

/* COMPONENTS */

function Card({ title, icon }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow hover:shadow-xl transform hover:-translate-y-2 transition">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-green-700">{title}</h3>
    </div>
  );
}

function Info({ title, text }) {
  return (
    <div className="bg-gray-50 p-6 rounded-xl shadow">
      <h3 className="font-semibold mb-2 text-green-700">{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Testimonial({ text, name }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow">
      <p>"{text}"</p>
      <h4 className="mt-4 font-bold text-green-700">{name}</h4>
    </div>
  );
}
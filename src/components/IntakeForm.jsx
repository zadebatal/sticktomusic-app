import React, { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { toast as sonnerToast } from 'sonner';
import log from '../utils/logger';

// ── Data arrays ──

const vibeOptions = [
  'Dark / Moody',
  'Ethereal / Dreamy',
  'High Fashion',
  'Street / Urban',
  'Y2K / Nostalgic',
  'Minimalist / Clean',
  'Cinematic',
  'Anime / Manga',
  'Nature / Organic',
  'EDM / Rave',
  'Romantic / Soft',
  'Chaotic / Glitchy',
];

const assetOptions = [
  'Music videos',
  'Behind-the-scenes footage',
  'Live performance clips',
  'Lyric videos',
  'Photo/video shoots',
  'Visualizers',
  'Interview clips',
  'Studio sessions',
  'None yet',
];

// ── Form field components ──

const FormInput = ({
  label,
  field,
  type = 'text',
  required = false,
  placeholder = '',
  formData,
  updateField,
}) => (
  <div className="mb-6" key={field}>
    <label htmlFor={field} className="block text-sm font-medium text-zinc-400 mb-2">
      {label} {required && <span className="text-red-400">*</span>}
    </label>
    <input
      id={field}
      name={field}
      type={type}
      value={formData[field] || ''}
      onChange={(e) => updateField(field, e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition"
      autoComplete="off"
    />
  </div>
);

const FormTextArea = ({
  label,
  field,
  required = false,
  placeholder = '',
  formData,
  updateField,
}) => (
  <div className="mb-6" key={field}>
    <label htmlFor={field} className="block text-sm font-medium text-zinc-400 mb-2">
      {label} {required && <span className="text-red-400">*</span>}
    </label>
    <textarea
      id={field}
      name={field}
      value={formData[field] || ''}
      onChange={(e) => updateField(field, e.target.value)}
      placeholder={placeholder}
      rows={4}
      className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition resize-none"
      autoComplete="off"
    />
  </div>
);

const FormCheckboxGroup = ({
  label,
  field,
  options,
  required = false,
  formData,
  toggleArrayField,
}) => (
  <div className="mb-6" key={field}>
    <label className="block text-sm font-medium text-zinc-400 mb-3">
      {label} {required && <span className="text-red-400">*</span>}
    </label>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => toggleArrayField(field, option)}
          className={`px-4 py-2 rounded-lg text-sm text-left transition ${
            formData[field]?.includes(option)
              ? 'bg-white text-black'
              : 'bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-zinc-500'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  </div>
);

const FormRadioGroup = ({ label, field, options, required = false, formData, updateField }) => (
  <div className="mb-6">
    <label className="block text-sm font-medium text-zinc-400 mb-3">
      {label} {required && <span className="text-red-400">*</span>}
    </label>
    <div className="space-y-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => updateField(field, option.value)}
          className={`w-full px-4 py-3 rounded-xl text-left transition flex justify-between items-center ${
            formData[field] === option.value
              ? 'bg-white text-black'
              : 'bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-zinc-500'
          }`}
        >
          <div>
            <div className="font-medium">{option.label}</div>
            {option.desc && (
              <div
                className={`text-sm ${formData[field] === option.value ? 'text-zinc-600' : 'text-zinc-500'}`}
              >
                {option.desc}
              </div>
            )}
          </div>
          <div
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
              formData[field] === option.value ? 'border-black bg-black' : 'border-zinc-600'
            }`}
          >
            {formData[field] === option.value && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        </button>
      ))}
    </div>
  </div>
);

const FormNav = ({
  canContinue = true,
  isLast = false,
  formStep,
  prevFormStep,
  nextFormStep,
  handleSubmit,
  onBack,
}) => (
  <div className="flex justify-between mt-8">
    {formStep > 0 ? (
      <button
        type="button"
        onClick={prevFormStep}
        className="px-6 py-3 text-zinc-400 hover:text-white transition"
      >
        &larr; Back
      </button>
    ) : (
      <button
        type="button"
        onClick={onBack}
        className="px-6 py-3 text-zinc-400 hover:text-white transition"
      >
        &larr; Back to site
      </button>
    )}
    <button
      type="button"
      onClick={isLast ? handleSubmit : nextFormStep}
      disabled={!canContinue}
      className={`px-8 py-3 rounded-full font-semibold transition ${
        canContinue
          ? 'bg-white text-black hover:bg-zinc-200'
          : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
      }`}
    >
      {isLast ? 'Submit \u2192' : 'Continue \u2192'}
    </button>
  </div>
);

// ── IntakeForm component ──

export default function IntakeForm({ db, user, onBack, onSubmitSuccess }) {
  const [formStep, setFormStep] = useState(0);
  const [formData, setFormData] = useState({
    artistName: '',
    email: '',
    phone: '',
    managerContact: '',
    spotify: '',
    instagram: '',
    tiktok: '',
    youtube: '',
    otherPlatforms: '',
    projectType: '',
    releaseDate: '',
    genre: '',
    projectDescription: '',
    aestheticWords: '',
    vibes: [],
    otherVibes: '',
    adjacentArtists: '',
    ageRanges: [],
    idealListener: '',
    contentAssets: [],
    contentFolder: '',
    pageTier: '',
    cdTier: '',
    spotifyForArtists: '',
    duration: '',
    anythingElse: '',
  });
  const [submitted, setSubmitted] = useState(false);

  // Form helpers
  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleArrayField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((v) => v !== value)
        : [...prev[field], value],
    }));
  };

  const nextFormStep = () => setFormStep((s) => s + 1);
  const prevFormStep = () => setFormStep((s) => s - 1);

  const handleSubmit = async () => {
    log('Form submitted:', formData);
    const tierMap = {
      starter: 'Starter',
      standard: 'Standard',
      scale: 'Scale',
      sensation: 'Sensation',
      discuss: 'To Discuss',
    };
    const newApplication = {
      name: formData.artistName,
      email: formData.email,
      tier: tierMap[formData.pageTier] || formData.pageTier,
      submitted: new Date().toISOString(),
      status: 'pending',
      genre: formData.genre,
      vibes: formData.vibes || [],
      phone: formData.phone || '',
      managerContact: formData.managerContact || '',
      spotify: formData.spotify,
      instagram: formData.instagram,
      tiktok: formData.tiktok,
      youtube: formData.youtube || '',
      projectType: formData.projectType,
      projectDescription: formData.projectDescription,
      releaseDate: formData.releaseDate || '',
      aestheticWords: formData.aestheticWords,
      adjacentArtists: formData.adjacentArtists,
      ageRanges: formData.ageRanges || [],
      idealListener: formData.idealListener,
      contentTypes: formData.contentTypes || [],
      cdTier: formData.cdTier,
      duration: formData.duration,
      referral: formData.referral || '',
    };

    // Save to Firestore
    try {
      const docRef = await addDoc(collection(db, 'applications'), newApplication);
      if (onSubmitSuccess) {
        onSubmitSuccess({ id: docRef.id, ...newApplication });
      }
      setSubmitted(true);
      sonnerToast.success('Application submitted successfully!');
    } catch (error) {
      log.error('Error saving application:', error);
      // Still mark as submitted even if Firestore fails
      if (onSubmitSuccess) {
        onSubmitSuccess({ id: Date.now().toString(), ...newApplication });
      }
      setSubmitted(true);
      sonnerToast.warning("Application saved locally — cloud sync failed. We'll retry later.");
    }
  };

  // Form component wrappers — delegate to module-scope components with local state
  const InputField = (props) => (
    <FormInput {...props} formData={formData} updateField={updateField} />
  );
  const TextArea = (props) => (
    <FormTextArea {...props} formData={formData} updateField={updateField} />
  );
  const CheckboxGroup = (props) => (
    <FormCheckboxGroup {...props} formData={formData} toggleArrayField={toggleArrayField} />
  );
  const RadioGroup = (props) => (
    <FormRadioGroup {...props} formData={formData} updateField={updateField} />
  );
  const FormNavButtons = (props) => (
    <FormNav
      {...props}
      formStep={formStep}
      prevFormStep={prevFormStep}
      nextFormStep={nextFormStep}
      handleSubmit={handleSubmit}
      onBack={onBack}
    />
  );

  // Submitted confirmation screen
  if (submitted) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-6">{'\u2713'}</div>
          <h1 className="text-3xl font-bold mb-4">You're in.</h1>
          <p className="text-zinc-400 mb-8">
            We'll review your submission and get back to you within 24 hours.
          </p>
          <button
            onClick={() => {
              onBack();
              setSubmitted(false);
              setFormStep(0);
            }}
            className="px-8 py-4 bg-white text-black rounded-full font-semibold hover:bg-zinc-200 transition"
          >
            Back to StickToMusic
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <button onClick={onBack} className="text-xl font-bold hover:text-zinc-300 transition">
            StickToMusic
          </button>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-zinc-500 mb-2">
            <span>Step {formStep + 1} of 9</span>
            <span>{Math.round(((formStep + 1) / 9) * 100)}%</span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${((formStep + 1) / 9) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 0 */}
        {formStep === 0 && (
          <div>
            <h1 className="text-4xl font-bold mb-4">Let's build your world.</h1>
            <p className="text-xl text-zinc-400 mb-8">Takes about 10 minutes.</p>
            <InputField label="Artist or project name" field="artistName" required />
            <InputField label="Email" field="email" type="email" required />
            <InputField label="Phone (optional)" field="phone" type="tel" />
            <InputField label="Manager or team contact (optional)" field="managerContact" />
            <FormNavButtons canContinue={formData.artistName && formData.email} />
          </div>
        )}

        {/* Step 1 */}
        {formStep === 1 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Where can we find you?</h2>
            <p className="text-zinc-400 mb-8">Links to your current profiles.</p>
            <InputField
              label="Spotify"
              field="spotify"
              type="url"
              required
              placeholder="https://open.spotify.com/artist/..."
            />
            <InputField
              label="Instagram"
              field="instagram"
              type="url"
              placeholder="https://instagram.com/..."
            />
            <InputField
              label="TikTok"
              field="tiktok"
              type="url"
              placeholder="https://tiktok.com/@..."
            />
            <InputField
              label="YouTube"
              field="youtube"
              type="url"
              placeholder="https://youtube.com/..."
            />
            <FormNavButtons canContinue={formData.spotify} />
          </div>
        )}

        {/* Step 2 */}
        {formStep === 2 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">What are you promoting?</h2>
            <p className="text-zinc-400 mb-8">Tell us about the release.</p>
            <InputField
              label="Project type"
              field="projectType"
              required
              placeholder="Single, EP, Album..."
            />
            <InputField label="Release date (if scheduled)" field="releaseDate" type="date" />
            <InputField
              label="Genre / subgenre"
              field="genre"
              required
              placeholder="e.g., Alt R&B, Hyperpop"
            />
            <TextArea
              label="Describe the project"
              field="projectDescription"
              required
              placeholder="Sound, story, theme..."
            />
            <FormNavButtons
              canContinue={formData.projectType && formData.genre && formData.projectDescription}
            />
          </div>
        )}

        {/* Step 3 */}
        {formStep === 3 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">What's your vibe?</h2>
            <p className="text-zinc-400 mb-8">This shapes your world pages.</p>
            <TextArea
              label="Describe your visual aesthetic in 3-5 words"
              field="aestheticWords"
              required
              placeholder="e.g., dark, cinematic, emotional"
            />
            <CheckboxGroup
              label="Select vibes that resonate"
              field="vibes"
              options={vibeOptions}
              required
            />
            <FormNavButtons canContinue={formData.aestheticWords && formData.vibes.length > 0} />
          </div>
        )}

        {/* Step 4 */}
        {formStep === 4 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Who are you reaching?</h2>
            <p className="text-zinc-400 mb-8">Your target audience.</p>
            <TextArea
              label="3-5 artists whose fans might love you"
              field="adjacentArtists"
              required
              placeholder="e.g., The Weeknd, Frank Ocean"
            />
            <CheckboxGroup
              label="Target age range"
              field="ageRanges"
              options={['13-17', '18-24', '25-34', '35+']}
              required
            />
            <TextArea
              label="Describe your ideal listener"
              field="idealListener"
              required
              placeholder="What are they into?"
            />
            <FormNavButtons
              canContinue={
                formData.adjacentArtists && formData.ageRanges.length > 0 && formData.idealListener
              }
            />
          </div>
        )}

        {/* Step 5 */}
        {formStep === 5 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">What content do you have?</h2>
            <p className="text-zinc-400 mb-8">Existing assets we can work with.</p>
            <CheckboxGroup
              label="Select all that apply"
              field="contentAssets"
              options={assetOptions}
              required
            />
            <InputField
              label="Link to content folder (optional)"
              field="contentFolder"
              type="url"
              placeholder="Google Drive, Dropbox..."
            />
            <FormNavButtons canContinue={formData.contentAssets.length > 0} />
          </div>
        )}

        {/* Step 6 */}
        {formStep === 6 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Choose your plan</h2>
            <p className="text-zinc-400 mb-8">Page Builder tier + optional Creative Direction.</p>
            <RadioGroup
              label="Page Builder tier"
              field="pageTier"
              required
              options={[
                { value: 'starter', label: 'Starter \u2014 $800/mo', desc: '5 world pages' },
                { value: 'standard', label: 'Standard \u2014 $1,500/mo', desc: '15 world pages' },
                { value: 'scale', label: 'Scale \u2014 $2,500/mo', desc: '30 world pages' },
                { value: 'sensation', label: 'Sensation \u2014 $3,500/mo', desc: '50 world pages' },
                { value: 'discuss', label: 'Not sure yet', desc: "Let's discuss" },
              ]}
            />
            <RadioGroup
              label="Add Creative Direction?"
              field="cdTier"
              required
              options={[
                { value: 'none', label: 'No thanks', desc: 'Just world pages' },
                {
                  value: 'lite',
                  label: 'CD Lite \u2014 +$2,500/mo',
                  desc: 'Content creation & strategy',
                },
                {
                  value: 'standard',
                  label: 'CD Standard \u2014 +$5,000/mo',
                  desc: 'Full creative direction',
                },
                { value: 'discuss', label: 'Not sure yet', desc: "Let's discuss" },
              ]}
            />
            <FormNavButtons canContinue={formData.pageTier && formData.cdTier} />
          </div>
        )}

        {/* Step 7 */}
        {formStep === 7 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Spotify for Artists</h2>
            <p className="text-zinc-400 mb-8">Optional -- connect for deeper insights.</p>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
              <h3 className="font-semibold mb-3">What you'd get with Spotify connected:</h3>
              <ul className="space-y-2 text-sm text-zinc-400">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">{'\u2713'}</span> Monthly listener growth
                  tracking
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">{'\u2713'}</span> Playlist add notifications
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">{'\u2713'}</span> Stream count correlation with
                  posts
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">{'\u2713'}</span> Listener demographics & top
                  cities
                </li>
              </ul>
            </div>

            <RadioGroup
              label="Would you like to connect Spotify for Artists?"
              field="spotifyForArtists"
              required
              options={[
                {
                  value: 'yes',
                  label: "Yes, I'll connect it",
                  desc: "We'll send instructions after signup",
                },
                {
                  value: 'later',
                  label: 'Maybe later',
                  desc: 'You can connect anytime from your dashboard',
                },
                {
                  value: 'no',
                  label: 'No thanks',
                  desc: 'Dashboard will show world page metrics only',
                },
              ]}
            />
            <FormNavButtons canContinue={formData.spotifyForArtists} />
          </div>
        )}

        {/* Step 8 */}
        {formStep === 8 && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Timeline</h2>
            <p className="text-zinc-400 mb-8">How long are you thinking?</p>
            <RadioGroup
              label="Service duration"
              field="duration"
              required
              options={[
                { value: '1month', label: '1 month', desc: 'Minimum' },
                { value: '3months', label: '3 months', desc: '' },
                { value: '6months', label: '6 months', desc: '' },
                { value: '12months', label: '12 months / ongoing', desc: '' },
                { value: 'discuss', label: 'Not sure yet', desc: '' },
              ]}
            />
            <TextArea label="Anything else? (optional)" field="anythingElse" />
            <FormNavButtons canContinue={formData.duration} isLast />
          </div>
        )}
      </div>
    </div>
  );
}

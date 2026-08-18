import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type AuthMode = 'customer' | 'professional' | null
type AuthView = 'signup' | 'login'
type AppRole = 'customer' | 'professional' | null

type Coordinates = {
  latitude: number
  longitude: number
}

type ProfessionalProfile = {
  id: string
  business_name: string | null
  description: string | null
  service_area_km: number | null
  is_available: boolean
  location: unknown
}

type SearchResult = ProfessionalProfile & {
  phone: string | null
  services: string[]
  distance_km: number | null
  average_rating: number | null
  review_count: number
}

const BrandLogo = () => (
  <img
    src="/abhifreehai-logo.png"
    alt="AbhiFreeHai"
    className="h-10 w-auto object-contain"
  />
)
const getCurrentLocation = (): Promise<Coordinates> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          'Location is not supported by this browser. Please use a browser that supports location services.',
        ),
      )
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      (locationError) => {
        if (locationError.code === 1) {
          reject(
            new Error(
              'Location permission is required to find nearby professionals.',
            ),
          )
        } else if (locationError.code === 2) {
          reject(
            new Error(
              'Your location could not be determined. Please try again.',
            ),
          )
        } else {
          reject(
            new Error(
              'Location request timed out. Please try again.',
            ),
          )
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      },
    )
  })

function App() {
  /*
   * ---------------------------------------------------------
   * AUTH / SESSION STATE
   * ---------------------------------------------------------
   */

  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<AppRole>(null)
  const [initializing, setInitializing] = useState(true)

  /*
   * ---------------------------------------------------------
   * AUTH MODAL STATE
   * ---------------------------------------------------------
   */

  const [authMode, setAuthMode] = useState<AuthMode>(null)
  const [authView, setAuthView] = useState<AuthView>('signup')

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')

  const [businessName, setBusinessName] = useState('')
  const [services, setServices] = useState('')

  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  /*
   * ---------------------------------------------------------
   * PROFESSIONAL STATE
   * ---------------------------------------------------------
   */

  const [professionalProfile, setProfessionalProfile] =
    useState<ProfessionalProfile | null>(null)

  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)

  /*
   * PROFESSIONAL PROFILE EDITING
   */
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileSaveLoading, setProfileSaveLoading] = useState(false)
  const [editBusinessName, setEditBusinessName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editServices, setEditServices] = useState('')
  const [editServiceAreaKm, setEditServiceAreaKm] = useState('10')

  /*
   * ---------------------------------------------------------
   * ACCOUNT DELETION
   * ---------------------------------------------------------
   */

  const [deleteLoading, setDeleteLoading] = useState(false)

  /*
   * ---------------------------------------------------------
   * CUSTOMER SEARCH STATE
   * ---------------------------------------------------------
   */

  const [searchService, setSearchService] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchPerformed, setSearchPerformed] = useState(false)

  /*
   * PUBLIC SEARCH STATE
   *
   * Customers can search from the landing page without
   * creating an account first.
   */
  const [publicSearchService, setPublicSearchService] = useState('')
  const [publicSearchResults, setPublicSearchResults] = useState<SearchResult[]>([])
  const [publicSearchLoading, setPublicSearchLoading] = useState(false)
  const [publicSearchError, setPublicSearchError] = useState('')
  const [publicSearchPerformed, setPublicSearchPerformed] = useState(false)

  /*
   * ---------------------------------------------------------
   * LOAD USER PROFILE
   * ---------------------------------------------------------
   */

  const loadUserProfile = async (currentUser: User | null) => {
    if (!currentUser) {
      setRole(null)
      setProfessionalProfile(null)
      return
    }

    /*
     * The role is stored in public.profiles.
     */
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', currentUser.id)
      .maybeSingle()

    if (profileError) {
      console.error('Could not load profile:', profileError)
    }

    const currentRole =
      profile?.role === 'professional' || profile?.role === 'customer'
        ? profile.role
        : currentUser.user_metadata?.role === 'professional'
          ? 'professional'
          : 'customer'

    setRole(currentRole)

    /*
     * If professional, load the real professional profile.
     */
    if (currentRole === 'professional') {
      const { data: professional, error: professionalError } =
        await supabase
          .from('professional_profiles')
          .select(
            'id, business_name, description, service_area_km, is_available, location',
          )
          .eq('id', currentUser.id)
          .maybeSingle()

      if (professionalError) {
        console.error(
          'Could not load professional profile:',
          professionalError,
        )
      }

      /*
       * If the professional registered while email confirmation was
       * enabled, the browser location was saved in auth metadata.
       * Once they have a session, write it into the real PostGIS
       * location column through the secure RPC.
       */
      let updatedProfessional = professional

      const metadataLatitude = Number(
        currentUser.user_metadata?.location_latitude,
      )
      const metadataLongitude = Number(
        currentUser.user_metadata?.location_longitude,
      )

      const hasValidMetadataLocation =
        Number.isFinite(metadataLatitude) &&
        Number.isFinite(metadataLongitude) &&
        metadataLatitude >= -90 &&
        metadataLatitude <= 90 &&
        metadataLongitude >= -180 &&
        metadataLongitude <= 180

      if (
        updatedProfessional &&
        !updatedProfessional.location &&
        hasValidMetadataLocation
      ) {
        const { error: locationError } = await supabase.rpc(
          'set_professional_location',
          {
            p_lat: metadataLatitude,
            p_lng: metadataLongitude,
          },
        )

        if (locationError) {
          console.error(
            'Could not save professional location:',
            locationError,
          )
        } else {
          updatedProfessional = {
            ...updatedProfessional,
            location: true,
          }
        }
      }

      setProfessionalProfile(updatedProfessional)
    } else {
      setProfessionalProfile(null)
    }
  }

  /*
   * ---------------------------------------------------------
   * AUTH SESSION LISTENER
   * ---------------------------------------------------------
   *
   * This fixes the old problem where Supabase knew the user
   * was authenticated but the React app kept showing the
   * landing page.
   */

  useEffect(() => {
    let mounted = true

    const initialiseAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      const currentUser = session?.user ?? null

      setUser(currentUser)

      if (currentUser) {
        await loadUserProfile(currentUser)
      }

      if (mounted) {
        setInitializing(false)
      }
    }

    initialiseAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null

      if (!mounted) return

      setUser(currentUser)

      if (currentUser) {
        await loadUserProfile(currentUser)
      } else {
        setRole(null)
        setProfessionalProfile(null)
      }

      setInitializing(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  /*
   * ---------------------------------------------------------
   * REALTIME AVAILABILITY
   * ---------------------------------------------------------
   *
   * Public availability changes are mirrored into the
   * professional_public_status table by the database trigger.
   * This subscription refreshes an already-visible search when
   * a professional switches availability or edits their public
   * profile.
   */

  useEffect(() => {
    if (!publicSearchPerformed && !searchPerformed) {
      return
    }

    const refreshActiveSearch = async () => {
      const activeQuery = user && role === 'customer'
        ? searchService.trim()
        : publicSearchService.trim()

      if (!activeQuery) return

      try {
        const results = await searchProfessionals(activeQuery)

        if (user && role === 'customer') {
          setSearchResults(results)
        } else {
          setPublicSearchResults(results)
        }
      } catch (refreshError) {
        console.error(
          'Realtime availability refresh failed:',
          refreshError,
        )
      }
    }

    const channel = supabase
      .channel('abhi-free-hai-public-status')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'professional_public_status',
        },
        () => {
          void refreshActiveSearch()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [
    publicSearchPerformed,
    searchPerformed,
    publicSearchService,
    searchService,
    user,
    role,
  ])

  /*
   * ---------------------------------------------------------
   * AUTH MODAL
   * ---------------------------------------------------------
   */

  const openAuth = (
    mode: AuthMode,
    view: AuthView = 'signup',
  ) => {
    setAuthMode(mode)
    setAuthView(view)

    setMessage('')
    setError('')

    setFullName('')
    setEmail('')
    setPhone('')
    setPassword('')
    setBusinessName('')
    setServices('')
  }

  const closeAuth = () => {
    if (loading) return

    setAuthMode(null)
    setMessage('')
    setError('')
  }

  const switchView = (view: AuthView) => {
    setAuthView(view)
    setMessage('')
    setError('')
  }

  /*
   * ---------------------------------------------------------
   * LOGIN / SIGNUP
   * ---------------------------------------------------------
   */

  const handleAuth = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    setLoading(true)
    setMessage('')
    setError('')

    try {
      /*
       * LOGIN
       */
      if (authView === 'login') {
        const { error: loginError } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })

        if (loginError) {
          throw loginError
        }

        /*
         * The auth listener above will receive the session
         * and switch the application to the correct dashboard.
         */
        setAuthMode(null)
        return
      }

      /*
       * SIGNUP
       */

      if (!authMode) {
        throw new Error('Please choose an account type.')
      }

      if (!fullName.trim()) {
        throw new Error('Please enter your full name.')
      }

      if (!phone.trim()) {
        throw new Error('Please enter your phone number.')
      }

      if (authMode === 'professional' && !services.trim()) {
        throw new Error('Please tell us what service you provide.')
      }

      /*
       * Professionals need a location so the backend can match
       * them to customers nearby. We capture it automatically from
       * the browser instead of asking the user to type an address.
       * Customers do not need to provide a location during signup.
       * Their location is requested only when they actually search.
       */
      let professionalCoordinates: Coordinates | null = null

      if (authMode === 'professional') {
        setLocationLoading(true)

        try {
          professionalCoordinates = await getCurrentLocation()
        } finally {
          setLocationLoading(false)
        }
      }

      const metadata = {
        full_name: fullName.trim(),
        role: authMode,
        phone: phone.trim(),

        business_name:
          authMode === 'professional'
            ? businessName.trim() || null
            : null,

        services:
          authMode === 'professional'
            ? services
                .split(',')
                .map((service) => service.trim())
                .filter(Boolean)
            : [],

        /*
         * Kept in auth metadata so the location survives email
         * confirmation. It is copied into professional_profiles
         * after the first authenticated session.
         */
        location_latitude:
          professionalCoordinates?.latitude ?? null,
        location_longitude:
          professionalCoordinates?.longitude ?? null,
      }

      const { data, error: signupError } =
        await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: metadata,
          },
        })

      if (signupError) {
        throw signupError
      }

      /*
       * If email confirmation is enabled, Supabase will not
       * give us a session yet.
       */
      if (!data.session) {
        setMessage(
          'Account created. Check your email to confirm your account, then sign in.',
        )
        return
      }

      /*
       * If confirmation is disabled, the auth listener will
       * take the user straight into the dashboard.
       */
      setAuthMode(null)
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  /*
   * ---------------------------------------------------------
   * SEARCH PROFESSIONALS
   * ---------------------------------------------------------
   *
   * This is intentionally public.
   * A customer does NOT need an account just to search.
   *
   * Flow:
   * services -> professional_services -> professional_profiles
   */
    const searchProfessionals = async (
    query: string,
  ): Promise<SearchResult[]> => {
    const cleanQuery = query.trim()

    if (!cleanQuery) {
      return []
    }

    /*
     * The customer's location is requested only when they search.
     * This keeps the landing page usable without signup while still
     * allowing the backend to return genuinely nearby professionals.
     */
    const customerLocation = await getCurrentLocation()

    /*
     * First resolve the user's natural-language search to the
     * closest canonical service using semantic search.
     *
     * Example:
     * "my tap is leaking"
     *        ↓
     * "Plumbing"
     */
    const {
      data: semanticData,
      error: semanticError,
    } = await supabase.functions.invoke(
      'semantic-service-search',
      {
        body: {
          query: cleanQuery,
        },
      },
    )

    if (semanticError) {
      throw semanticError
    }

    const matches = Array.isArray(
      semanticData?.matches,
    )
      ? semanticData.matches
      : []

    /*
     * Use the best semantic match when available.
     * If semantic search returns nothing, fall back to
     * the original user query so the existing search still works.
     */
    const resolvedService =
      matches.length > 0 &&
      typeof matches[0]?.service_name === 'string'
        ? matches[0].service_name
        : cleanQuery

    /*
     * The actual distance and service-radius filtering happens
     * inside the Postgres RPC.
     *
     * We do NOT fetch professional coordinates into the browser.
     */
    const { data, error } = await supabase.rpc(
  'search_professionals',
  {
    p_service: resolvedService,
    p_lat: customerLocation.latitude,
    p_lng: customerLocation.longitude,
  },
)

if (error) {
  throw error
}

return (data ?? []).map(
  (professional: {
    id: string
    phone: string | null
    business_name: string | null
    description: string | null
    service_area_km: number | null
    is_available: boolean
    distance_km: number | null
    services: string[]
    average_rating: number | null
    review_count: number | null
  }) => ({
    id: professional.id,
    phone: professional.phone ?? null,
    business_name:
      professional.business_name ?? null,
    description:
      professional.description ?? null,
    service_area_km:
      professional.service_area_km != null
        ? Number(
            professional.service_area_km,
          )
        : null,
    is_available: Boolean(
      professional.is_available,
    ),
    location: null,
    distance_km:
      professional.distance_km != null
        ? Number(
            professional.distance_km,
          )
        : null,
    services: Array.isArray(
      professional.services,
    )
      ? professional.services
      : [],
    average_rating:
      professional.average_rating != null
        ? Number(
            professional.average_rating,
          )
        : null,
    review_count:
      professional.review_count != null
        ? Number(
            professional.review_count,
          )
        : null,
  }),
)
  }

/*
 * Search from the public landing page.
 */
const handlePublicSearch = async (
  event: FormEvent<HTMLFormElement>,
) => {
  event.preventDefault()

  const query =
    publicSearchService.trim()

  if (!query) {
    setPublicSearchError(
      'Enter a service to search.',
    )
    setPublicSearchResults([])
    setPublicSearchPerformed(false)
    return
  }

  setPublicSearchLoading(true)
  setPublicSearchError('')
  setPublicSearchPerformed(true)
  setPublicSearchResults([])

  try {
    const results =
      await searchProfessionals(query)

    setPublicSearchResults(results)
  } catch (searchErr) {
    console.error(
      'Public search failed:',
      searchErr,
    )

    setPublicSearchError(
      searchErr instanceof Error
        ? searchErr.message
        : 'Could not search right now. Please try again.',
    )
  } finally {
    setPublicSearchLoading(false)
  }
}

/*
 * Search from the signed-in customer dashboard.
 */
const handleCustomerSearch = async (
  event: FormEvent<HTMLFormElement>,
) => {
  event.preventDefault()

  const query =
    searchService.trim()

  if (!query) {
    setSearchError(
      'Enter a service to search.',
    )
    setSearchResults([])
    setSearchPerformed(false)
    return
  }

  setSearchLoading(true)
  setSearchError('')
  setSearchPerformed(true)
  setSearchResults([])

  try {
    const results =
      await searchProfessionals(query)

    setSearchResults(results)
  } catch (searchErr) {
    console.error(
      'Customer search failed:',
      searchErr,
    )

    setSearchError(
      searchErr instanceof Error
        ? searchErr.message
        : 'Could not search right now. Please try again.',
    )
  } finally {
    setSearchLoading(false)
  }
}
  /*
   * ---------------------------------------------------------
   * LOGOUT
   * ---------------------------------------------------------
   */
  const handleLogout = async () => {
    setLoading(true)

    const { error: logoutError } =
      await supabase.auth.signOut()

    setLoading(false)

    if (logoutError) {
      setError(logoutError.message)
      return
    }

    setUser(null)
    setRole(null)
    setProfessionalProfile(null)
  }

  /*
   * ---------------------------------------------------------
   * DELETE ACCOUNT
   * ---------------------------------------------------------
   */

  const handleDeleteAccount = async () => {
    if (!user || deleteLoading) return

    const confirmed = window.confirm(
      'Delete your AbhiFreeHai account permanently? This cannot be undone.',
    )

    if (!confirmed) return

    setDeleteLoading(true)
    setError('')
    setMessage('')

    try {
      const { error: deleteError } = await supabase.rpc(
        'delete_my_account',
      )

      if (deleteError) {
        throw deleteError
      }

      await supabase.auth.signOut()

      setUser(null)
      setRole(null)
      setProfessionalProfile(null)
      setSearchResults([])
      setPublicSearchResults([])
      setSearchPerformed(false)
      setPublicSearchPerformed(false)
      setMessage('Your account has been deleted.')
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Could not delete your account.',
      )
    } finally {
      setDeleteLoading(false)
    }
  }

  /*
   * ---------------------------------------------------------
   * PROFESSIONAL PROFILE EDITING
   * ---------------------------------------------------------
   */

  const startProfileEditing = () => {
    if (!professionalProfile) return

    const metadataServices = Array.isArray(user?.user_metadata?.services)
      ? user.user_metadata.services
      : []

    setEditBusinessName(
      professionalProfile.business_name ||
        user?.user_metadata?.business_name ||
        '',
    )
    setEditDescription(professionalProfile.description || '')
    setEditServices(metadataServices.join(', '))
    setEditServiceAreaKm(
      String(professionalProfile.service_area_km ?? 10),
    )
    setEditingProfile(true)
    setError('')
    setMessage('')
  }

  const cancelProfileEditing = () => {
    if (profileSaveLoading) return

    setEditingProfile(false)
    setError('')
    setMessage('')
  }

  const saveProfessionalProfile = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    if (!user || role !== 'professional') return

    const cleanBusinessName = editBusinessName.trim()
    const cleanDescription = editDescription.trim()
    const nextServices = [
      ...new Set(
        editServices
          .split(',')
          .map((service) => service.trim())
          .filter(Boolean),
      ),
    ]
    const parsedRadius = Number(editServiceAreaKm)

    if (parsedRadius < 1 || parsedRadius > 100) {
      setError('Service radius must be between 1 and 100 km.')
      return
    }

    if (nextServices.length === 0) {
      setError('Add at least one service.')
      return
    }

    setProfileSaveLoading(true)
    setError('')
    setMessage('')

    try {
      const { data: updatedProfile, error: profileUpdateError } =
        await supabase
          .from('professional_profiles')
          .update({
            business_name: cleanBusinessName || null,
            description: cleanDescription || null,
            service_area_km: parsedRadius,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select(
            'id, business_name, description, service_area_km, is_available, location',
          )
          .single()

      if (profileUpdateError) {
        throw profileUpdateError
      }

      /*
       * Rebuild the professional's service links from the edited list.
       * Existing service definitions are reused when their names match.
       */
      const { error: deleteLinksError } = await supabase
        .from('professional_services')
        .delete()
        .eq('professional_id', user.id)

      if (deleteLinksError) {
        throw deleteLinksError
      }

      for (const serviceName of nextServices) {
        const { data: existingService, error: existingServiceError } =
          await supabase
            .from('services')
            .select('id, name')
            .ilike('name', serviceName)
            .limit(1)
            .maybeSingle()

        if (existingServiceError) {
          throw existingServiceError
        }

        let serviceId = existingService?.id

        if (!serviceId) {
          const { data: createdService, error: createServiceError } =
            await supabase
              .from('services')
              .insert({ name: serviceName })
              .select('id')
              .single()

          if (createServiceError) {
            throw createServiceError
          }

          serviceId = createdService.id
        }

        const { error: linkError } = await supabase
          .from('professional_services')
          .insert({
            professional_id: user.id,
            service_id: serviceId,
          })

        if (linkError) {
          throw linkError
        }
      }

      /*
       * Keep the auth metadata aligned with the editable profile so
       * the dashboard remains correct even after a fresh session.
       */
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          business_name: cleanBusinessName || null,
          services: nextServices,
        },
      })

      if (metadataError) {
        console.error(
          'Profile saved, but auth metadata could not be updated:',
          metadataError,
        )
      }

      setProfessionalProfile(updatedProfile)
      setEditingProfile(false)
      setMessage('Profile updated successfully.')
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Could not save your profile.',
      )
    } finally {
      setProfileSaveLoading(false)
    }
  }

  /*
   * ---------------------------------------------------------
   * PROFESSIONAL AVAILABILITY
   * ---------------------------------------------------------
   *
   * This updates the REAL professional_profiles row.
   *
   * No fake green button.
   * No local-only state pretending to be a database.
   */

  const toggleAvailability = async () => {
    if (!user || role !== 'professional') return

    const currentAvailability =
      professionalProfile?.is_available ?? false

    const nextAvailability = !currentAvailability

    setAvailabilityLoading(true)
    setError('')

    try {
      const { data, error: updateError } = await supabase
        .from('professional_profiles')
        .update({
          is_available: nextAvailability,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .select(
          'id, business_name, description, service_area_km, is_available, location',
        )
        .single()

      if (updateError) {
        throw updateError
      }

      setProfessionalProfile(data)
    } catch (availabilityError) {
      setError(
        availabilityError instanceof Error
          ? availabilityError.message
          : 'Could not update your availability.',
      )
    } finally {
      setAvailabilityLoading(false)
    }
  }

  /*
   * ---------------------------------------------------------
   * INITIAL LOADING
   * ---------------------------------------------------------
   */

  if (initializing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-sm text-gray-400">
          Loading AbhiFreeHai...
        </div>
      </main>
    )
  }

  /*
   * ---------------------------------------------------------
   * AUTHENTICATED PROFESSIONAL DASHBOARD
   * ---------------------------------------------------------
   */

  if (user && role === 'professional') {
    const metadataServices =
      Array.isArray(user.user_metadata?.services)
        ? user.user_metadata.services
        : []

    const isAvailable =
      professionalProfile?.is_available ?? false

    return (
      <main className="min-h-screen bg-white text-gray-900">
        <div className="mx-auto min-h-screen max-w-5xl px-6 py-8 sm:px-8 lg:px-10">

          {/* Header */}
          <header className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0 })}
              className="flex items-center"
              aria-label="Go to home"
            >
              <BrandLogo />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loading}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-950 disabled:opacity-50"
            >
              Log out
            </button>
          </header>

          {/* Dashboard */}
          <section className="mx-auto max-w-3xl pt-16">

            <div className="text-sm font-semibold text-green-600">
              Professional dashboard
            </div>

            <h1 className="mt-3 text-4xl font-bold tracking-tight text-gray-950 sm:text-5xl">
              {professionalProfile?.business_name ||
                user.user_metadata?.business_name ||
                user.user_metadata?.full_name ||
                'Your professional profile'}
            </h1>

            <p className="mt-4 max-w-2xl text-base leading-7 text-gray-500">
              Let customers know when you're actually available.
              Turn your status on when you're ready to take calls.
            </p>

            {/* Availability Card */}
            <div
              className={`mt-10 rounded-3xl border p-6 transition ${
                isAvailable
                  ? 'border-green-200 bg-green-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">

                <div>
                  <div className="text-sm font-medium text-gray-500">
                    Your availability
                  </div>

                  <div
                    className={`mt-2 flex items-center gap-2 text-2xl font-bold ${
                      isAvailable
                        ? 'text-green-700'
                        : 'text-gray-900'
                    }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-full ${
                        isAvailable
                          ? 'bg-green-500'
                          : 'bg-red-500'
                      }`}
                    />

                    {isAvailable
                      ? 'Available now'
                      : 'Not available'}
                  </div>

                  <p className="mt-2 text-sm leading-6 text-gray-500">
                    {isAvailable
                      ? 'Customers can see you as available.'
                      : 'You are currently hidden from available results.'}
                  </p>
                </div>

                {/* REAL RED / GREEN BUTTON */}
                <button
                  type="button"
                  onClick={toggleAvailability}
                  disabled={
                    availabilityLoading ||
                    !professionalProfile
                  }
                  className={`relative inline-flex h-14 w-28 shrink-0 items-center rounded-full p-1 transition ${
                    isAvailable
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  } disabled:cursor-wait disabled:opacity-60`}
                  aria-label={
                    isAvailable
                      ? 'Turn availability off'
                      : 'Turn availability on'
                  }
                >
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-full bg-white text-xs font-bold shadow-md transition-transform ${
                      isAvailable
                        ? 'translate-x-14'
                        : 'translate-x-0'
                    }`}
                  >
                    {availabilityLoading
                      ? '...'
                      : isAvailable
                        ? 'ON'
                        : 'OFF'}
                  </span>
                </button>

              </div>
            </div>

            {/* Profile */}
            <div className="mt-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">

              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-semibold text-gray-950">
                  Your profile
                </div>

                {!editingProfile && (
                  <button
                    type="button"
                    onClick={startProfileEditing}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:text-gray-950"
                  >
                    Edit profile
                  </button>
                )}
              </div>

              {!editingProfile ? (
                <>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2">

                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                        Name
                      </div>

                      <div className="mt-1 text-sm text-gray-900">
                        {user.user_metadata?.full_name ||
                          'Not provided'}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                        Phone
                      </div>

                      <div className="mt-1 text-sm text-gray-900">
                        {user.user_metadata?.phone ||
                          'Not provided'}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                        Email
                      </div>

                      <div className="mt-1 break-all text-sm text-gray-900">
                        {user.email}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                        Business
                      </div>

                      <div className="mt-1 text-sm text-gray-900">
                        {professionalProfile?.business_name ||
                          user.user_metadata?.business_name ||
                          'Independent professional'}
                      </div>
                    </div>

                  </div>

                  {/* Services */}
                  <div className="mt-7 border-t border-gray-100 pt-6">

                    <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                      Services
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">

                      {metadataServices.length > 0 ? (
                        metadataServices.map(
                          (service: string) => (
                            <span
                              key={service}
                              className="rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700"
                            >
                              {service}
                            </span>
                          ),
                        )
                      ) : (
                        <span className="text-sm text-gray-400">
                          No services added yet.
                        </span>
                      )}

                    </div>
                  </div>
                </>
              ) : (
                <form
                  onSubmit={saveProfessionalProfile}
                  className="mt-6 space-y-5"
                >
                  <div>
                    <label
                      htmlFor="edit-business-name"
                      className="mb-2 block text-sm font-medium text-gray-800"
                    >
                      Business name
                    </label>

                    <input
                      id="edit-business-name"
                      type="text"
                      value={editBusinessName}
                      onChange={(event) =>
                        setEditBusinessName(event.target.value)
                      }
                      placeholder="Your shop or business name"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="edit-description"
                      className="mb-2 block text-sm font-medium text-gray-800"
                    >
                      Description
                    </label>

                    <textarea
                      id="edit-description"
                      value={editDescription}
                      onChange={(event) =>
                        setEditDescription(event.target.value)
                      }
                      rows={4}
                      placeholder="Briefly describe your service."
                      className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="edit-services"
                      className="mb-2 block text-sm font-medium text-gray-800"
                    >
                      Services
                    </label>

                    <input
                      id="edit-services"
                      type="text"
                      value={editServices}
                      onChange={(event) =>
                        setEditServices(event.target.value)
                      }
                      placeholder="e.g. AC repair, installation"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                    />

                    <p className="mt-2 text-xs text-gray-400">
                      Separate multiple services with commas.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="edit-service-area"
                      className="mb-2 block text-sm font-medium text-gray-800"
                    >
                      Service radius
                    </label>

                    <select
                      id="edit-service-area"
                      value={editServiceAreaKm}
                      onChange={(event) =>
                        setEditServiceAreaKm(event.target.value)
                      }
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                    >
                      {[5, 10, 15, 20, 25, 30, 50].map((radius) => (
                        <option key={radius} value={radius}>
                          {radius} km
                        </option>
                      ))}
                    </select>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-5 text-red-600">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={cancelProfileEditing}
                      disabled={profileSaveLoading}
                      className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:opacity-50"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={profileSaveLoading}
                      className="flex-1 rounded-xl bg-gray-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60"
                    >
                      {profileSaveLoading
                        ? 'Saving...'
                        : 'Save changes'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Location status */}
            <div className="mt-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold text-gray-950">
                Service location
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    professionalProfile?.location
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  }`}
                />

                <span className="text-sm font-medium text-gray-800">
                  {professionalProfile?.location
                    ? 'Location is set'
                    : 'Location is not set'}
                </span>
              </div>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                Your exact location is used privately for nearby matching.
                Customers only see the approximate distance, not your
                coordinates.
              </p>
            </div>

            <div className="mt-8 rounded-3xl border border-dashed border-gray-200 p-6">
              <div className="text-sm font-semibold text-gray-950">
                Customer contact
              </div>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                Customers can call your saved phone number directly when
                you are available and within your service area.
              </p>
            </div>

            {/* Account danger zone */}
            <div className="mt-8 rounded-3xl border border-red-100 bg-red-50/50 p-6">
              <div className="text-sm font-semibold text-red-700">
                Delete account
              </div>

              <p className="mt-2 text-sm leading-6 text-red-600/80">
                Permanently remove your account, professional profile,
                services, and associated data.
              </p>

              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
                className="mt-4 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
              >
                {deleteLoading ? 'Deleting account...' : 'Delete account'}
              </button>
            </div>

            {error && (
              <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-5 text-red-600">
                {error}
              </div>
            )}

          </section>

          <footer className="py-12 text-center text-sm text-gray-400">
            Simple. Live. Local.
          </footer>

        </div>
      </main>
    )
  }

  /*
   * ---------------------------------------------------------
   * AUTHENTICATED CUSTOMER DASHBOARD
   * ---------------------------------------------------------
   */
  if (user && role === 'customer') {
    return (
      <main className="min-h-screen bg-white text-gray-900">
        <div className="mx-auto min-h-screen max-w-6xl px-6 py-8 sm:px-8 lg:px-10">

          {/* Header */}
          <header className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0 })}
              className="flex items-center"
              aria-label="Go to home"
            >
              <BrandLogo />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loading}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-950 disabled:opacity-50"
            >
              Log out
            </button>
          </header>

          <section className="mx-auto max-w-4xl pt-20 text-center">

            <div className="text-sm font-semibold text-green-600">
              Customer
            </div>

            <h1 className="mt-3 text-4xl font-bold tracking-tight text-gray-950 sm:text-6xl">
              Find help when you need it.
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-gray-500 sm:text-lg">
              Search for a service and find real professionals
              who are available to help.
            </p>

            {/* Search */}
            <form
              onSubmit={handleCustomerSearch}
              className="mx-auto mt-10 flex w-full max-w-2xl items-center rounded-2xl border border-gray-200 bg-white p-2 shadow-sm focus-within:border-gray-300 focus-within:shadow-md"
            >

              <div className="flex flex-1 items-center gap-3 px-4">

                <span className="text-gray-400">
                  ⌕
                </span>

                <input
                  type="search"
                  value={searchService}
                  onChange={(event) =>
                    setSearchService(event.target.value)
                  }
                  placeholder="What service do you need?"
                  className="w-full bg-transparent py-3 text-base text-gray-900 outline-none placeholder:text-gray-400"
                />

              </div>

              <button
                type="submit"
                disabled={searchLoading}
                className="rounded-xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60"
              >
                {searchLoading ? 'Searching...' : 'Search'}
              </button>

            </form>

            {searchError && (
              <div className="mx-auto mt-5 max-w-2xl rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-left text-sm text-red-600">
                {searchError}
              </div>
            )}

            {/* Search results */}
            {searchPerformed && !searchLoading && (
              <div className="mx-auto mt-10 max-w-2xl text-left">

                <div className="mb-5">
                  <div className="text-sm font-semibold text-gray-950">
                    {searchResults.length > 0
                      ? `${searchResults.length} ${
                          searchResults.length === 1
                            ? 'professional'
                            : 'professionals'
                        } available`
                      : 'No one available right now'}
                  </div>

                  <p className="mt-1 text-sm text-gray-500">
                    Results for "{searchService.trim()}"
                  </p>
                </div>

                {searchResults.length > 0 ? (
                  <div className="space-y-4">
                    {searchResults.map((professional) => (
                      <article
                        key={professional.id}
                        className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-4">

                          <div className="min-w-0">

                            {professional.is_available && (
                              <div className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />

                                <span className="text-xs font-semibold text-green-600">
                                  AVAILABLE NOW
                                </span>
                              </div>
                            )}

                            <h3 className="mt-2 text-lg font-semibold text-gray-950">
                              {professional.business_name ||
                                'Local business'}
                            </h3>

<div className="mt-2 flex items-center gap-2 text-sm">
  {professional.average_rating != null &&
  professional.review_count > 0 ? (
    <>
      <span className="font-semibold text-gray-900">
        ★ {professional.average_rating.toFixed(1)}
      </span>

      <span className="text-gray-500">
        {professional.review_count}{' '}
        {professional.review_count === 1
          ? 'review'
          : 'reviews'}
      </span>
    </>
  ) : (
    <span className="text-gray-400">
      No ratings yet
    </span>
  )}
</div>

                            {professional.services.length > 0 && (
                              <p className="mt-1 text-sm text-gray-500">
                                {professional.services.join(' · ')}
                              </p>
                            )}

                            {professional.description && (
                              <p className="mt-3 text-sm leading-6 text-gray-600">
                                {professional.description}
                              </p>
                            )}

                            {professional.distance_km != null &&
                              Number.isFinite(professional.distance_km) && (
                                <p className="mt-2 text-sm font-medium text-gray-500">
                                  {professional.distance_km < 1
                                    ? `${Math.round(
                                        professional.distance_km * 1000,
                                      )} m away`
                                    : `${professional.distance_km.toFixed(
                                        1,
                                      )} km away`}
                                </p>
                              )}

                          </div>

                          {professional.phone ? (
                            <a
                              href={`tel:${professional.phone}`}
                              className="shrink-0 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800"
                            >
                              Call
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="shrink-0 rounded-xl bg-gray-300 px-4 py-2.5 text-sm font-semibold text-white"
                              title="Phone number unavailable"
                            >
                              Call
                            </button>
                          )}

                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center">
                    <div className="text-lg font-semibold text-gray-950">
                      No available professionals yet.
                    </div>

                    <p className="mt-2 text-sm leading-6 text-gray-500">
                      Try another service or check again later.
                    </p>
                  </div>
                )}

              </div>
            )}

            {/* Account danger zone */}
            <div className="mx-auto mt-10 max-w-2xl rounded-3xl border border-red-100 bg-red-50/50 p-6 text-left">
              <div className="text-sm font-semibold text-red-700">
                Delete account
              </div>

              <p className="mt-2 text-sm leading-6 text-red-600/80">
                Permanently remove your AbhiFreeHai account and associated data.
              </p>

              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
                className="mt-4 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
              >
                {deleteLoading ? 'Deleting account...' : 'Delete account'}
              </button>
            </div>

          </section>

          <footer className="py-16 text-center text-sm text-gray-400">
            Simple. Live. Local.
          </footer>

        </div>
      </main>
    )
  }

  /*
   * ---------------------------------------------------------
   * PUBLIC LANDING PAGE
   * ---------------------------------------------------------
   */

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto min-h-screen max-w-6xl px-6 py-8 sm:px-8 lg:px-10">

        {/* Header */}
        <header>
          <button
            type="button"
            onClick={() =>
              window.scrollTo({
                top: 0,
                behavior: 'smooth',
              })
            }
            className="flex items-center"
            aria-label="Go to home"
          >
            <BrandLogo />
          </button>
        </header>

        {/* Hero */}
        <section className="mx-auto flex max-w-4xl flex-col items-center pt-24 text-center sm:pt-28">

          <h1 className="text-5xl font-bold tracking-[-0.04em] text-gray-950 sm:text-6xl lg:text-7xl">
            Find someone who's free.
            <span className="block text-green-600">
              Right now.
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-base leading-7 text-gray-500 sm:text-lg">
            Search for any service and see professionals
            who are available right now.
          </p>

          {/* Search */}
          <form
            onSubmit={handlePublicSearch}
            className="mt-10 w-full max-w-2xl"
          >
            <div className="flex items-center rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition focus-within:border-gray-300 focus-within:shadow-md">

              <div className="flex flex-1 items-center gap-3 px-4">

                <span className="text-gray-400">
                  ⌕
                </span>

                <input
                  type="search"
                  value={publicSearchService}
                  onChange={(event) =>
                    setPublicSearchService(event.target.value)
                  }
                  placeholder="What service do you need?"
                  className="w-full bg-transparent py-3 text-base text-gray-900 outline-none placeholder:text-gray-400"
                />

              </div>

              <button
                type="submit"
                disabled={publicSearchLoading}
                className="rounded-xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60"
              >
                {publicSearchLoading ? 'Searching...' : 'Search'}
              </button>

            </div>
          </form>

          {publicSearchError && (
            <div className="mt-5 w-full max-w-2xl rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-left text-sm text-red-600">
              {publicSearchError}
            </div>
          )}

          {/* Public search results */}
          {publicSearchPerformed && !publicSearchLoading && (
            <section className="mt-10 w-full max-w-2xl text-left">

              <div className="mb-5">
                <div className="text-sm font-semibold text-gray-950">
                  {publicSearchResults.length > 0
                    ? `${publicSearchResults.length} ${
                        publicSearchResults.length === 1
                          ? 'professional'
                          : 'professionals'
                      } available`
                    : 'No one available right now'}
                </div>

                <p className="mt-1 text-sm text-gray-500">
                  Results for "{publicSearchService.trim()}"
                </p>
              </div>

              {publicSearchResults.length > 0 ? (
                <div className="space-y-4">
                  {publicSearchResults.map((professional) => (
                    <article
                      key={professional.id}
                      className="rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">

                        <div className="min-w-0">

                          {professional.is_available && (
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full bg-green-500" />

                              <span className="text-xs font-semibold text-green-600">
                                AVAILABLE NOW
                              </span>
                            </div>
                          )}

                          <h3 className="mt-2 text-lg font-semibold text-gray-950">
                            {professional.business_name ||
                              'Local business'}
                          </h3>

                          {professional.services.length > 0 && (
                            <p className="mt-1 text-sm text-gray-500">
                              {professional.services.join(' · ')}
                            </p>
                          )}

                          {professional.description && (
                            <p className="mt-3 text-sm leading-6 text-gray-600">
                              {professional.description}
                            </p>
                          )}

                          {professional.distance_km != null &&
                            Number.isFinite(professional.distance_km) && (
                              <p className="mt-2 text-sm font-medium text-gray-500">
                                {professional.distance_km < 1
                                  ? `${Math.round(
                                      professional.distance_km * 1000,
                                    )} m away`
                                  : `${professional.distance_km.toFixed(
                                      1,
                                    )} km away`}
                              </p>
                            )}

                        </div>

                        {professional.phone ? (
                          <a
                            href={`tel:${professional.phone}`}
                            className="shrink-0 rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-gray-800"
                          >
                            Call
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="shrink-0 rounded-xl bg-gray-300 px-4 py-2.5 text-sm font-semibold text-white"
                            title="Phone number unavailable"
                          >
                            Call
                          </button>
                        )}

                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center">
                  <div className="text-lg font-semibold text-gray-950">
                    No available professionals yet.
                  </div>

                  <p className="mt-2 text-sm leading-6 text-gray-500">
                    Try another service or check again later.
                  </p>
                </div>
              )}

            </section>
          )}

          {/* Professional CTA */}
          <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row">

            <span className="text-sm text-gray-500">
              Are you a service professional?
            </span>

            <button
              type="button"
              onClick={() => openAuth('professional')}
              className="font-semibold text-gray-950 underline decoration-gray-300 underline-offset-4 transition hover:decoration-gray-950"
            >
              Join AbhiFreeHai →
            </button>

          </div>

          {/* Customer CTA */}
          <button
            type="button"
            onClick={() => openAuth('customer')}
            className="mt-8 text-sm font-medium text-gray-500 transition hover:text-gray-950"
          >
            Sign in or create an account
          </button>

        </section>

        {/* How it works */}
        <section className="mx-auto mt-28 max-w-5xl border-y border-gray-100 py-12">

          <div className="grid gap-10 md:grid-cols-3 md:gap-8">

            <div>
              <div className="text-sm font-semibold text-green-600">
                01
              </div>

              <h2 className="mt-3 text-lg font-semibold text-gray-950">
                Search
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                Search for exactly the service you need.
              </p>
            </div>

            <div>
              <div className="text-sm font-semibold text-green-600">
                02
              </div>

              <h2 className="mt-3 text-lg font-semibold text-gray-950">
                Find
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                See professionals who are available now.
              </p>
            </div>

            <div>
              <div className="text-sm font-semibold text-green-600">
                03
              </div>

              <h2 className="mt-3 text-lg font-semibold text-gray-950">
                Call
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-500">
                Contact them directly. No bookings or middlemen.
              </p>
            </div>

          </div>

        </section>

        {/* Footer */}
        <footer className="py-10 text-center text-sm text-gray-400">
          Simple. Live. Local.
        </footer>

      </div>

      {/* =====================================================
          AUTHENTICATION MODAL
          ===================================================== */}

      {authMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 px-5 py-8 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeAuth()
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-7 shadow-2xl sm:p-8">

            {/* Header */}
            <div className="flex items-start justify-between gap-5">

              <div>

                <div className="text-sm font-semibold text-green-600">
                  {authView === 'signup'
                    ? authMode === 'professional'
                      ? 'Professional registration'
                      : 'Create your account'
                    : 'Welcome back'}
                </div>

                <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-950">
                  {authView === 'signup'
                    ? authMode === 'professional'
                      ? 'Get discovered when you’re free.'
                      : 'Find help when you need it.'
                    : 'Sign in to AbhiFreeHai'}
                </h2>

                <p className="mt-2 text-sm leading-6 text-gray-500">
                  {authView === 'signup'
                    ? authMode === 'professional'
                      ? 'Tell us a little about your service so customers can find you.'
                      : 'Create an account to search and connect with nearby professionals.'
                    : 'Use the email and password linked to your account.'}
                </p>

              </div>

              <button
                type="button"
                onClick={closeAuth}
                disabled={loading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-gray-400 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
                aria-label="Close"
              >
                ×
              </button>

            </div>

            {/* Account type */}
            {authView === 'signup' && (
              <div className="mt-7 grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1">

                <button
                  type="button"
                  onClick={() =>
                    openAuth('customer', 'signup')
                  }
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    authMode === 'customer'
                      ? 'bg-white text-gray-950 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  I need a service
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openAuth('professional', 'signup')
                  }
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    authMode === 'professional'
                      ? 'bg-white text-gray-950 shadow-sm'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  I provide a service
                </button>

              </div>
            )}

            {/* Form */}
            <form
              onSubmit={handleAuth}
              className="mt-7 space-y-4"
            >

              {/* Signup fields */}
              {authView === 'signup' && (
                <>

                  {/* Full name */}
                  <div>

                    <label
                      htmlFor="full-name"
                      className="mb-2 block text-sm font-medium text-gray-800"
                    >
                      Full name
                    </label>

                    <input
                      id="full-name"
                      type="text"
                      value={fullName}
                      onChange={(event) =>
                        setFullName(event.target.value)
                      }
                      required
                      autoComplete="name"
                      placeholder="Your full name"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                    />

                  </div>

                  {/* Phone */}
                  <div>

                    <label
                      htmlFor="phone"
                      className="mb-2 block text-sm font-medium text-gray-800"
                    >
                      Phone number
                    </label>

                    <input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(event) =>
                        setPhone(event.target.value)
                      }
                      required
                      autoComplete="tel"
                      placeholder="Your phone number"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                    />

                  </div>

                  {/* Professional-only fields */}
                  {authMode === 'professional' && (
                    <>

                      {/* Business */}
                      <div>

                        <label
                          htmlFor="business-name"
                          className="mb-2 block text-sm font-medium text-gray-800"
                        >
                          Business name
                          <span className="ml-1 font-normal text-gray-400">
                            optional
                          </span>
                        </label>

                        <input
                          id="business-name"
                          type="text"
                          value={businessName}
                          onChange={(event) =>
                            setBusinessName(
                              event.target.value,
                            )
                          }
                          placeholder="Your shop or business name"
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                        />

                      </div>

                      {/* Services */}
                      <div>

                        <label
                          htmlFor="services"
                          className="mb-2 block text-sm font-medium text-gray-800"
                        >
                          What service do you provide?
                        </label>

                        <input
                          id="services"
                          type="text"
                          value={services}
                          onChange={(event) =>
                            setServices(event.target.value)
                          }
                          required
                          placeholder="e.g. AC repair, installation"
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                        />

                        <p className="mt-2 text-xs leading-5 text-gray-400">
                          Enter multiple services separated
                          by commas.
                        </p>

                      </div>

                      {/* Automatic location */}
                      <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3">
                        <div className="text-sm font-semibold text-green-800">
                          Location is automatic
                        </div>

                        <p className="mt-1 text-xs leading-5 text-green-700">
                          We use your current location to show you to
                          nearby customers. You will be asked to allow
                          location access when you create your account.
                        </p>
                      </div>

                    </>
                  )}

                </>
              )}

              {/* Email */}
              <div>

                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-gray-800"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                />

              </div>

              {/* Password */}
              <div>

                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-gray-800"
                >
                  Password
                </label>

                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  required
                  minLength={8}
                  autoComplete={
                    authView === 'signup'
                      ? 'new-password'
                      : 'current-password'
                  }
                  placeholder="At least 8 characters"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
                />

              </div>

              {/* Error */}
              {error && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-5 text-red-600">
                  {error}
                </div>
              )}

              {/* Message */}
              {message && (
                <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm leading-5 text-green-700">
                  {message}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-gray-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60"
              >
                {loading
                  ? locationLoading
                    ? 'Getting your location...'
                    : 'Please wait...'
                  : authView === 'signup'
                    ? authMode === 'professional'
                      ? 'Create professional account'
                      : 'Create account'
                    : 'Sign in'}
              </button>

            </form>

            {/* Switch login/signup */}
            <div className="mt-6 text-center text-sm text-gray-500">

              {authView === 'signup' ? (
                <>
                  Already have an account?{' '}

                  <button
                    type="button"
                    onClick={() => switchView('login')}
                    className="font-semibold text-gray-950 underline underline-offset-4"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  Don't have an account?{' '}

                  <button
                    type="button"
                    onClick={() =>
                      switchView('signup')
                    }
                    className="font-semibold text-gray-950 underline underline-offset-4"
                  >
                    Create one
                  </button>
                </>
              )}

            </div>

          </div>
        </div>
      )}
    </main>
  )
}

export default App

/*
 * ---------------------------------------------------------
 * SIMPLE ANALYTICS TRACKING
 * ---------------------------------------------------------
 * Tracks:
 * - page_view
 * - search
 * - call_click
 * - signup
 *
 * Uses Supabase RPC:
 * public.log_analytics_event(...)
 */

if (typeof window !== 'undefined') {
  const ANALYTICS_SESSION_KEY = 'abhi_free_hai_analytics_session'

  const getAnalyticsSessionId = () => {
    let sessionId = localStorage.getItem(ANALYTICS_SESSION_KEY)

    if (!sessionId) {
      sessionId =
        `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

      localStorage.setItem(
        ANALYTICS_SESSION_KEY,
        sessionId,
      )
    }

    return sessionId
  }

  const getTrafficSource = () => {
    const params = new URLSearchParams(
      window.location.search,
    )

    const utmSource = params.get('utm_source')

    if (utmSource) {
      return utmSource.toLowerCase()
    }

    const referrer = document.referrer.toLowerCase()

    if (referrer.includes('instagram.com')) {
      return 'instagram'
    }

    if (referrer.includes('facebook.com')) {
      return 'facebook'
    }

    if (referrer.includes('whatsapp.com')) {
      return 'whatsapp'
    }

    if (referrer.includes('google.')) {
      return 'google'
    }

    if (referrer.includes('youtube.com')) {
      return 'youtube'
    }

    if (referrer.includes('twitter.com') || referrer.includes('x.com')) {
      return 'x'
    }

    return referrer ? 'referral' : 'direct'
  }

  const logAnalyticsEvent = async (
    eventName: string,
    metadata: Record<string, unknown> = {},
  ) => {
    try {
      const { error } = await supabase.rpc(
        'log_analytics_event',
        {
          p_event_name: eventName,
          p_session_id: getAnalyticsSessionId(),
          p_source: getTrafficSource(),
          p_role: null,
          p_metadata: metadata,
        },
      )

      if (error) {
        console.error(
          'Analytics event failed:',
          error,
        )
      }
    } catch (analyticsError) {
      console.error(
        'Analytics error:',
        analyticsError,
      )
    }
  }

  /*
   * PAGE VIEW
   */
  const pageViewKey = 'abhi_free_hai_page_view_logged'

  if (!sessionStorage.getItem(pageViewKey)) {
    sessionStorage.setItem(pageViewKey, '1')

    void logAnalyticsEvent(
      'page_view',
      {
        path: window.location.pathname,
        page: document.title,
      },
    )
  }

  /*
   * CLICK + FORM TRACKING
   *
   * Uses event delegation so we don't have to edit
   * the existing 2,300+ line React component.
   */
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      /*
       * CALL BUTTON
       */
      const callLink =
        target.closest<HTMLAnchorElement>(
          'a[href^="tel:"]',
        )

      if (callLink) {
        void logAnalyticsEvent(
          'call_click',
          {
            phone_present: true,
          },
        )
        return
      }

      /*
       * SIGNUP BUTTON
       */
      const button =
        target.closest<HTMLButtonElement>('button')

      if (!button) {
        return
      }

      const buttonText =
        button.textContent
          ?.trim()
          .toLowerCase() || ''

      if (
        buttonText.includes(
          'create professional account',
        ) ||
        buttonText === 'create account'
      ) {
        void logAnalyticsEvent(
          'signup',
          {
            button_text: button.textContent?.trim() || null,
          },
        )
      }
    },
    true,
  )

  /*
   * SEARCH TRACKING
   */
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target

      if (!(form instanceof HTMLFormElement)) {
        return
      }

      const searchInput =
        form.querySelector<HTMLInputElement>(
          'input[type="search"]',
        )

      if (!searchInput) {
        return
      }

      const searchTerm =
        searchInput.value.trim()

      if (!searchTerm) {
        return
      }

      void logAnalyticsEvent(
        'search',
        {
          query: searchTerm,
        },
      )
    },
    true,
  )
}
            
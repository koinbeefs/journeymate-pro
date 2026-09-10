export type TransitType = "car" | "bus" | "train" | "plane" | "ferry" | "bike" | "walk" | "jeepney" | "tricycle" | "uv_express" | "custom";
export type TripStatus = "planning" | "active" | "completed" | "cancelled";
export type WeatherCondition = "sunny" | "cloudy" | "rainy" | "stormy" | "snowy" | "foggy" | "windy";
export type ReportType = "trip-summary" | "expense" | "itinerary" | "analytics";
export type ThemeMode = "light" | "dark" | "adventure" | "ocean" | "sunset";
export type Language = "en" | "es" | "fr" | "de" | "ja" | "ko" | "zh" | "ar" | "hi" | "pt";
export type ExpenseCategory = "food" | "transport" | "accommodation" | "activities" | "shopping" | "other";
export type Currency = "PHP" | "USD" | "EUR" | "JPY" | "GBP" | "KRW" | "CNY" | "AUD" | "SGD" | "THB";

export interface Location {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: "city" | "poi" | "landmark" | "hotel" | "restaurant" | "gas-station" | "viewpoint";
  description?: string;
  address?: string;

  rating?: number;
  imageUrl?: string;
  photo_references?: string[];
  reviews_data?: any[];
}

export interface TransitSegment {
  id: string;
  type: TransitType;
  title: string;                 // e.g. "Tricycle to Mayantoc Crossing"
  departureName?: string;        // e.g. "Capas Junction"
  arrivalName?: string;          // e.g. "Mayantoc Town Plaza"
  durationMinutes?: number;      // Estimated duration in mins
  costEstimate?: number;          // Estimated fare in PHP
  distanceKm?: number;            // Distance in km
  agency?: string;               // e.g. "Victory Liner" or "LRT Line 1"
  lineName?: string;             // e.g. "Route 4 / Bus 102"
  instructions?: string;         // e.g. "Board at Bay 3, alight at Crossing"
  polyline?: string;             // Polyline for map display
}

export interface ItineraryStop {
  id: string;
  location: Location;
  arrivalTime: string;
  departureTime: string;
  notes: string;
  transitType: TransitType;
  transitSegments?: TransitSegment[];
  weather?: WeatherCondition;
  temperature?: number;
  isCompleted: boolean;
  distanceFromPrevious?: number;
  driveTimeFromPrevious?: number;
  dayNumber?: number;
}

export interface Expense {
  id: string;
  tripId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: Currency;
  paidBy: string; // userId
  splitAmong: string[]; // userIds
  date: string;
  receipt?: string;
}

export interface TripBudget {
  tripId: string;
  totalBudget: number;
  currency: Currency;
  categories: { category: ExpenseCategory; allocated: number; spent: number }[];
}

export interface CurrencyRate {
  from: Currency;
  to: Currency;
  rate: number;
}

export interface Trip {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  destination?: string;
  transitType?: TransitType;
  status: TripStatus;
  coverImage: string;
  stops: ItineraryStop[];
  collaborators: TravelUser[];
  isOfflineAvailable: boolean;
  expenses?: Expense[];
  budget?: TripBudget;
  total_distance?: number;
  total_duration?: number;
  centerLat?: number;
  centerLng?: number;
  owner?: TravelUser;
}

export interface TravelUser {
  id: string;
  name: string;
  avatar: string;
  isOnline: boolean;
  lastLocation?: { lat: number; lng: number };
  role: "owner" | "editor" | "viewer";
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  message: string;
  timestamp: string;
  type: "text" | "location" | "image" | "itinerary-update";
}

export interface Review {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  locationId: string;
  locationName: string;
  rating: number;
  comment: string;
  images: string[];
  timestamp: string;
  helpful: number;
}

export interface RouteInfo {
  distance: string;
  duration: string;
  speedLimit?: string;
  restrictions?: string[];
  tollFee?: string;
  fuelStops: Location[];
  viewpoints: Location[];
}

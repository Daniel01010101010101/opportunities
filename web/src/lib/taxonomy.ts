import taxonomyJson from '@config/taxonomy.json'
import {
  AtSign, Camera, Dices, Gamepad2, HelpCircle, PartyPopper, ShoppingBag,
  BadgeCheck, Banknote, Bike, BookOpen, Briefcase, Building2, Bus, Cake, CalendarClock, Car, Clapperboard, Cpu, CreditCard,
  FlaskConical, Fuel, Gift, GraduationCap, HandCoins, Home, Landmark, Laptop, Lightbulb, Megaphone, Package, Palette, Percent,
  Plane, Refrigerator, Rocket, RotateCcw, Shirt, ShoppingCart, Smartphone, Sofa, Sparkles, Star, Ticket, TicketPercent, Trophy,
  Truck, Tv, UserPlus, Users, Utensils, UtensilsCrossed, Wallet, Wifi, type LucideIcon,
} from 'lucide-react'
import type { CostType, SectionId, TaxCategory, TaxSection, VerificationStatus } from './types'

const ICONS: Record<string, LucideIcon> = {
  AtSign, Camera, Dices, Gamepad2, HelpCircle, PartyPopper, ShoppingBag,
  BadgeCheck, Banknote, Bike, BookOpen, Briefcase, Building2, Bus, Cake, CalendarClock, Car, Clapperboard, Cpu, CreditCard,
  FlaskConical, Fuel, Gift, GraduationCap, HandCoins, Home, Landmark, Laptop, Lightbulb, Megaphone, Package, Palette, Percent,
  Plane, Refrigerator, Rocket, RotateCcw, Shirt, ShoppingCart, Smartphone, Sofa, Sparkles, Star, Ticket, TicketPercent, Trophy,
  Truck, Tv, UserPlus, Users, Utensils, UtensilsCrossed, Wallet, Wifi,
}

export const icon = (name?: string): LucideIcon => (name && ICONS[name]) || Sparkles

type Tax = {
  sections: TaxSection[]
  categories: TaxCategory[]
  cost_types: Record<CostType, { label: string; free: boolean; description: string }>
  verification_statuses: Record<VerificationStatus, { label: string; description: string }>
  mechanics: Record<string, { label: string; icon: string }>
}
export const taxonomy = taxonomyJson as unknown as Tax

export const sections = taxonomy.sections
export const sectionById = Object.fromEntries(sections.map((s) => [s.id, s])) as Record<SectionId, TaxSection>
export const categoryById = Object.fromEntries(taxonomy.categories.map((c) => [c.id, c])) as Record<string, TaxCategory>
export const categoriesOf = (section: SectionId) => taxonomy.categories.filter((c) => c.section === section)
export const costTypes = taxonomy.cost_types
export const verificationLabels = taxonomy.verification_statuses
export const mechanicsMeta = taxonomy.mechanics ?? {}

export const FREE_TYPES: CostType[] = ['gratis', 'gratis_registro', 'gratis_actividad']

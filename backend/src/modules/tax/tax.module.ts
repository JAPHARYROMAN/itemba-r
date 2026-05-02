import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TaxAuthoritiesModule } from './tax-authorities/tax-authorities.module';
import { CompanyTaxRegistrationsModule } from './company-tax-registrations/company-tax-registrations.module';
import { TaxTypesModule } from './tax-types/tax-types.module';
import { TaxRatesModule } from './tax-rates/tax-rates.module';
import { TaxCodesModule } from './tax-codes/tax-codes.module';
import { TaxTransactionsModule } from './tax-transactions/tax-transactions.module';
import { TaxFilingPeriodsModule } from './tax-filing-periods/tax-filing-periods.module';
import { TaxReturnsModule } from './tax-returns/tax-returns.module';
import { TaxCalculatorService } from './tax-calculator.service';

/**
 * Global so any domain module (sales, purchases, payroll) can inject
 * TaxCalculatorService directly without re-importing the tax module.
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    TaxAuthoritiesModule,
    CompanyTaxRegistrationsModule,
    TaxTypesModule,
    TaxRatesModule,
    TaxCodesModule,
    TaxTransactionsModule,
    TaxFilingPeriodsModule,
    TaxReturnsModule,
  ],
  providers: [TaxCalculatorService],
  exports: [
    TaxAuthoritiesModule,
    CompanyTaxRegistrationsModule,
    TaxTypesModule,
    TaxRatesModule,
    TaxCodesModule,
    TaxTransactionsModule,
    TaxFilingPeriodsModule,
    TaxReturnsModule,
    TaxCalculatorService,
  ],
})
export class TaxModule {}
